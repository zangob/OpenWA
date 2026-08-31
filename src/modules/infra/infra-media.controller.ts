import { Controller, Get, Post, Param, Res, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiConsumes } from '@nestjs/swagger';
import * as path from 'path';
import { Public } from '../auth/decorators/auth.decorators';
import { StorageService } from '../../common/storage/storage.service';

/**
 * Ad-hoc media upload/retrieval used by the dashboard "Campaigns" flow: an operator picks an image
 * for a campaign message and gets back a URL the campaign template can reference.
 */
@ApiTags('infrastructure')
@Controller('infra')
export class InfraMediaController {
  constructor(private readonly storageService: StorageService) {}

  @Post('media/upload')
  @Public()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an image/media file and return a URL for use in campaigns' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Image or media file' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'File stored, returns path and URL' })
  async uploadMedia(
    @UploadedFile()
    file: {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File too large (max 10MB)');
    }

    const ext = path.extname(file.originalname) || '.bin';
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = `uploads/${safeName}`;

    await this.storageService.putFile(filePath, file.buffer);

    return {
      path: filePath,
      url: `/api/infra/media/${encodeURIComponent(safeName)}`,
      mimetype: file.mimetype,
      size: file.size,
      originalName: file.originalname,
    };
  }

  @Get('media/:filename')
  @Public()
  @ApiOperation({ summary: 'Retrieve an uploaded media file' })
  async getMedia(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = decodeURIComponent(filename);
    const filePath = `uploads/${safeName}`;

    try {
      const data = await this.storageService.getFile(filePath);
      const ext = path.extname(safeName).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg',
      };
      res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(data);
    } catch {
      res.status(404).json({ statusCode: 404, message: 'File not found' });
    }
  }
}
