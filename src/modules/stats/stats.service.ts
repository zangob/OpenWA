import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MongoRepository } from 'typeorm';
import { Session, SessionStatus } from '../session/entities/session.entity';
import { Message, MessageStatus } from '../message/entities/message.entity';
import { CacheService } from '../../common/cache';

export interface OverviewStats {
  sessions: {
    active: number;
    total: number;
    byStatus: Record<string, number>;
  };
  messages: {
    sent: number;
    received: number;
    failed: number;
    today: { sent: number; received: number };
  };
}

export interface TimeSeriesPoint {
  timestamp: string;
  sent: number;
  received: number;
}

export interface MessageStats {
  timeSeries: TimeSeriesPoint[];
  byType: Record<string, number>;
  bySession: Array<{ sessionId: string; name: string; sent: number; received: number }>;
  topChats: Array<{ chatId: string; messageCount: number }>;
}

export interface SessionStats {
  session: { id: string; name: string; status: string };
  messages: { sent: number; received: number; today: number; failed: number };
  topChats: Array<{ chatId: string; count: number; lastActive: string }>;
  hourlyActivity: Array<{ hour: number; sent: number; received: number }>;
}

@Injectable()
export class StatsService {
  private readonly isMongo: boolean;

  constructor(
    @InjectRepository(Session, 'data')
    private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Message, 'data')
    private readonly messageRepo: Repository<Message>,
    private readonly cacheService: CacheService,
  ) {
    this.isMongo = (this.messageRepo.metadata?.connection?.options?.type as string) === 'mongodb';
  }

  async getOverview(): Promise<OverviewStats> {
    // Get session stats (compatible across all drivers)
    const sessions = await this.sessionRepo.find();
    const byStatus: Record<string, number> = {};
    let active = 0;

    for (const session of sessions) {
      byStatus[session.status] = (byStatus[session.status] || 0) + 1;
      if (session.status === SessionStatus.READY) active++;
    }

    let sent = 0;
    let received = 0;
    let todaySent = 0;
    let todayReceived = 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    if (this.isMongo) {
      // MongoDB native aggregation
      const mongoRepo = this.messageRepo as unknown as MongoRepository<Message>;

      const messageStats = await mongoRepo
        .aggregate<{ _id: string; count: number }>([{ $group: { _id: '$direction', count: { $sum: 1 } } }])
        .toArray();

      const todayStats = await mongoRepo
        .aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: todayStart } } },
          { $group: { _id: '$direction', count: { $sum: 1 } } },
        ])
        .toArray();

      sent = messageStats.find(m => m._id === 'outgoing')?.count || 0;
      received = messageStats.find(m => m._id === 'incoming')?.count || 0;
      todaySent = todayStats.find(m => m._id === 'outgoing')?.count || 0;
      todayReceived = todayStats.find(m => m._id === 'incoming')?.count || 0;
    } else {
      // SQL (SQLite / Postgres)
      const messageStats = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .groupBy('m.direction')
        .getRawMany<{ direction: string; count: string }>();

      const todayStats = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .where('m.createdAt >= :todayStart', { todayStart })
        .groupBy('m.direction')
        .getRawMany<{ direction: string; count: string }>();

      sent = parseInt(messageStats.find(m => m.direction === 'outgoing')?.count || '0');
      received = parseInt(messageStats.find(m => m.direction === 'incoming')?.count || '0');
      todaySent = parseInt(todayStats.find(m => m.direction === 'outgoing')?.count || '0');
      todayReceived = parseInt(todayStats.find(m => m.direction === 'incoming')?.count || '0');
    }

    // Count failed messages
    const failed = await this.messageRepo.count({
      where: { status: MessageStatus.FAILED },
    });

    await this.cacheService.setSessionsStats({
      active,
      total: sessions.length,
      byStatus,
    });

    return {
      sessions: { active, total: sessions.length, byStatus },
      messages: { sent, received, failed, today: { sent: todaySent, received: todayReceived } },
    };
  }

  async getMessageStats(period: '24h' | '7d' | '30d'): Promise<MessageStats> {
    const since = this.getPeriodStart(period);
    const interval = period === '24h' ? 'hour' : 'day';

    const timeSeries = await this.getTimeSeries(since, interval);

    const byType: Record<string, number> = {};
    let bySession: Array<{ sessionId: string; name: string; sent: number; received: number }> = [];
    let topChatsRaw: Array<{ chatId: string; messageCount: number }> = [];

    if (this.isMongo) {
      const mongoRepo = this.messageRepo as unknown as MongoRepository<Message>;

      // By type
      const byTypeRaw = await mongoRepo
        .aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
        ])
        .toArray();
      for (const row of byTypeRaw) {
        byType[row._id || 'unknown'] = row.count;
      }

      // By session + direction
      const bySessionRaw = await mongoRepo
        .aggregate<{ _id: { sessionId: string; direction: string }; count: number }>([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: { sessionId: '$sessionId', direction: '$direction' }, count: { $sum: 1 } } },
        ])
        .toArray();

      const sessionMap = new Map<string, { sent: number; received: number }>();
      for (const row of bySessionRaw) {
        const sid = row._id.sessionId;
        if (!sessionMap.has(sid)) sessionMap.set(sid, { sent: 0, received: 0 });
        const entry = sessionMap.get(sid)!;
        if (row._id.direction === 'outgoing') entry.sent = row.count;
        else entry.received = row.count;
      }

      const sessions = await this.sessionRepo.find();
      const sessionNames = new Map(sessions.map(s => [s.id, s.name]));
      bySession = Array.from(sessionMap.entries()).map(([sessionId, stats]) => ({
        sessionId,
        name: sessionNames.get(sessionId) || 'Unknown',
        ...stats,
      }));

      // Top chats
      const topRaw = await mongoRepo
        .aggregate<{ _id: string; messageCount: number }>([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: '$chatId', messageCount: { $sum: 1 } } },
          { $sort: { messageCount: -1 } },
          { $limit: 10 },
        ])
        .toArray();
      topChatsRaw = topRaw.map(r => ({ chatId: r._id, messageCount: r.messageCount }));
    } else {
      // SQL path
      const byTypeRawSql = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.type', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('m.createdAt >= :since', { since })
        .groupBy('m.type')
        .getRawMany<{ type: string; count: string }>();

      for (const row of byTypeRawSql) {
        byType[row.type || 'unknown'] = parseInt(row.count);
      }

      const bySessionRawSql = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.sessionId', 'sessionId')
        .addSelect('m.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .where('m.createdAt >= :since', { since })
        .groupBy('m.sessionId')
        .addGroupBy('m.direction')
        .getRawMany<{ sessionId: string; direction: string; count: string }>();

      const sessionMap = new Map<string, { sent: number; received: number }>();
      for (const row of bySessionRawSql) {
        if (!sessionMap.has(row.sessionId)) sessionMap.set(row.sessionId, { sent: 0, received: 0 });
        const entry = sessionMap.get(row.sessionId)!;
        if (row.direction === 'outgoing') entry.sent = parseInt(row.count);
        else entry.received = parseInt(row.count);
      }

      const sessions = await this.sessionRepo.find();
      const sessionNames = new Map(sessions.map(s => [s.id, s.name]));
      bySession = Array.from(sessionMap.entries()).map(([sessionId, stats]) => ({
        sessionId,
        name: sessionNames.get(sessionId) || 'Unknown',
        ...stats,
      }));

      const topSql = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.chatId', 'chatId')
        .addSelect('COUNT(*)', 'messageCount')
        .where('m.createdAt >= :since', { since })
        .groupBy('m.chatId')
        .orderBy('messageCount', 'DESC')
        .limit(10)
        .getRawMany<{ chatId: string; messageCount: string }>();

      topChatsRaw = topSql.map(c => ({ chatId: c.chatId, messageCount: parseInt(c.messageCount) }));
    }

    return { timeSeries, byType, bySession, topChats: topChatsRaw };
  }

  async getSessionStats(sessionId: string): Promise<SessionStats> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let sent = 0;
    let received = 0;
    let todayCount = 0;
    let topChats: Array<{ chatId: string; count: number; lastActive: string }> = [];
    let hourlyActivity: Array<{ hour: number; sent: number; received: number }> = [];

    const failed = await this.messageRepo.count({
      where: { sessionId, status: MessageStatus.FAILED },
    });

    if (this.isMongo) {
      const mongoRepo = this.messageRepo as unknown as MongoRepository<Message>;

      const stats = await mongoRepo
        .aggregate<{ _id: string; count: number }>([
          { $match: { sessionId } },
          { $group: { _id: '$direction', count: { $sum: 1 } } },
        ])
        .toArray();
      sent = stats.find(s => s._id === 'outgoing')?.count || 0;
      received = stats.find(s => s._id === 'incoming')?.count || 0;

      const todayResult = await mongoRepo
        .aggregate<{ count: number }>([{ $match: { sessionId, createdAt: { $gte: todayStart } } }, { $count: 'count' }])
        .toArray();
      todayCount = todayResult[0]?.count || 0;

      const topRaw = await mongoRepo
        .aggregate<{ _id: string; count: number; lastActive: Date }>([
          { $match: { sessionId } },
          { $group: { _id: '$chatId', count: { $sum: 1 }, lastActive: { $max: '$createdAt' } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .toArray();
      topChats = topRaw.map(c => ({
        chatId: c._id,
        count: c.count,
        lastActive: c.lastActive ? new Date(c.lastActive).toISOString() : '',
      }));

      hourlyActivity = await this.getHourlyActivityMongo(sessionId);
    } else {
      const statsSql = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.direction', 'direction')
        .addSelect('COUNT(*)', 'count')
        .where('m.sessionId = :sessionId', { sessionId })
        .groupBy('m.direction')
        .getRawMany<{ direction: string; count: string }>();

      todayCount = await this.messageRepo
        .createQueryBuilder('m')
        .where('m.sessionId = :sessionId', { sessionId })
        .andWhere('m.createdAt >= :todayStart', { todayStart })
        .getCount();

      sent = parseInt(statsSql.find(s => s.direction === 'outgoing')?.count || '0');
      received = parseInt(statsSql.find(s => s.direction === 'incoming')?.count || '0');

      const topSql = await this.messageRepo
        .createQueryBuilder('m')
        .select('m.chatId', 'chatId')
        .addSelect('COUNT(*)', 'count')
        .addSelect('MAX(m.createdAt)', 'lastActive')
        .where('m.sessionId = :sessionId', { sessionId })
        .groupBy('m.chatId')
        .orderBy('count', 'DESC')
        .limit(10)
        .getRawMany<{ chatId: string; count: string; lastActive: string }>();

      topChats = topSql.map(c => ({ chatId: c.chatId, count: parseInt(c.count), lastActive: c.lastActive }));
      hourlyActivity = await this.getHourlyActivitySql(sessionId);
    }

    return {
      session: { id: session.id, name: session.name, status: session.status },
      messages: { sent, received, today: todayCount, failed },
      topChats,
      hourlyActivity,
    };
  }

  private getPeriodStart(period: '24h' | '7d' | '30d'): Date {
    const now = new Date();
    switch (period) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  private async getTimeSeries(since: Date, interval: 'hour' | 'day'): Promise<TimeSeriesPoint[]> {
    if (this.isMongo) {
      const mongoRepo = this.messageRepo as unknown as MongoRepository<Message>;
      const dateFormat =
        interval === 'hour'
          ? { year: '$year', month: '$month', day: '$dayOfMonth', hour: '$hour' }
          : { year: '$year', month: '$month', day: '$dayOfMonth' };

      const raw = await mongoRepo
        .aggregate<{
          _id: Record<string, number>;
          sent: number;
          received: number;
        }>([
          { $match: { createdAt: { $gte: since } } },
          {
            $group: {
              _id: Object.fromEntries(Object.entries(dateFormat).map(([k, v]) => [k, { [v]: '$createdAt' }])),
              sent: { $sum: { $cond: [{ $eq: ['$direction', 'outgoing'] }, 1, 0] } },
              received: { $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0] } },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } },
        ])
        .toArray();

      return raw.map(r => {
        const d = r._id;
        const ts =
          interval === 'hour'
            ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} ${String(d.hour || 0).padStart(2, '0')}:00:00`
            : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        return { timestamp: ts, sent: r.sent, received: r.received };
      });
    }

    // SQLite path
    const formatStr = interval === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    const raw = await this.messageRepo
      .createQueryBuilder('m')
      .select(`strftime('${formatStr}', m.createdAt)`, 'timestamp')
      .addSelect(`SUM(CASE WHEN m.direction = 'outgoing' THEN 1 ELSE 0 END)`, 'sent')
      .addSelect(`SUM(CASE WHEN m.direction = 'incoming' THEN 1 ELSE 0 END)`, 'received')
      .where('m.createdAt >= :since', { since })
      .groupBy('timestamp')
      .orderBy('timestamp', 'ASC')
      .getRawMany<{ timestamp: string; sent: string; received: string }>();

    return raw.map(r => ({
      timestamp: r.timestamp,
      sent: parseInt(r.sent || '0'),
      received: parseInt(r.received || '0'),
    }));
  }

  private async getHourlyActivityMongo(
    sessionId: string,
  ): Promise<Array<{ hour: number; sent: number; received: number }>> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const mongoRepo = this.messageRepo as unknown as MongoRepository<Message>;

    const raw = await mongoRepo
      .aggregate<{ _id: number; sent: number; received: number }>([
        { $match: { sessionId, createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            sent: { $sum: { $cond: [{ $eq: ['$direction', 'outgoing'] }, 1, 0] } },
            received: { $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0] } },
          },
        },
      ])
      .toArray();

    const hourMap = new Map(raw.map(r => [r._id, r]));
    const result: Array<{ hour: number; sent: number; received: number }> = [];
    for (let h = 0; h < 24; h++) {
      const data = hourMap.get(h);
      result.push({ hour: h, sent: data?.sent || 0, received: data?.received || 0 });
    }
    return result;
  }

  private async getHourlyActivitySql(
    sessionId: string,
  ): Promise<Array<{ hour: number; sent: number; received: number }>> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const raw = await this.messageRepo
      .createQueryBuilder('m')
      .select(`CAST(strftime('%H', m.createdAt) AS INTEGER)`, 'hour')
      .addSelect(`SUM(CASE WHEN m.direction = 'outgoing' THEN 1 ELSE 0 END)`, 'sent')
      .addSelect(`SUM(CASE WHEN m.direction = 'incoming' THEN 1 ELSE 0 END)`, 'received')
      .where('m.sessionId = :sessionId', { sessionId })
      .andWhere('m.createdAt >= :since', { since })
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany<{ hour: string; sent: string; received: string }>();

    const result: Array<{ hour: number; sent: number; received: number }> = [];
    const hourMap = new Map(raw.map(r => [parseInt(r.hour), r]));
    for (let h = 0; h < 24; h++) {
      const data = hourMap.get(h);
      result.push({
        hour: h,
        sent: data ? parseInt(data.sent || '0') : 0,
        received: data ? parseInt(data.received || '0') : 0,
      });
    }
    return result;
  }
}
