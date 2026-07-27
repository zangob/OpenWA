import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum, Min, Max } from 'class-validator';

export enum PhoneColumnType {
  PHONE = 'phone',
  MOBILE = 'mobile',
  NUMBER = 'number',
  WHATSAPP = 'whatsapp',
  CUSTOM = 'custom',
}

export enum FileType {
  CSV = 'csv',
  EXCEL = 'excel',
  XLSX = 'xlsx',
  XLS = 'xls',
}

export class BulkUploadOptionsDto {
  @ApiPropertyOptional({
    description: 'Phone number column name or type',
    enum: PhoneColumnType,
    default: PhoneColumnType.PHONE,
  })
  @IsOptional()
  @IsEnum(PhoneColumnType)
  phoneColumn?: PhoneColumnType;

  @ApiPropertyOptional({
    description: 'Custom column name (if phoneColumn is CUSTOM)',
    example: 'mobile_number',
  })
  @IsOptional()
  @IsString()
  customColumnName?: string;

  @ApiPropertyOptional({
    description: 'Skip first N rows (header rows)',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  skipRows?: number;

  @ApiPropertyOptional({
    description: 'Country code to prepend if missing (e.g., +62, 62)',
    example: '+62',
  })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'Delay between messages in ms (min: 1000, default: 3000)',
    default: 3000,
  })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(60000)
  delayBetweenMessages?: number;

  @ApiPropertyOptional({
    description: 'Add random 0-2s to delay',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  randomizeDelay?: boolean;

  @ApiPropertyOptional({
    description: 'Stop batch on first error',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  stopOnError?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum numbers to process (0 = unlimited)',
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxNumbers?: number;
}

export class BulkUploadMessageDto {
  @ApiProperty({
    description: 'Message type',
    enum: ['text', 'image', 'video', 'audio', 'document'],
    example: 'text',
  })
  @IsEnum(['text', 'image', 'video', 'audio', 'document'])
  type: 'text' | 'image' | 'video' | 'audio' | 'document';

  @ApiProperty({
    description: 'Message text content (for text messages or captions)',
    example: 'Hello {name}! This is a bulk message.',
  })
  @IsString()
  text: string;

  @ApiPropertyOptional({
    description: 'Media URL (for image/video/audio/document)',
    example: 'https://example.com/image.jpg',
  })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({
    description: 'Media base64 (alternative to URL)',
  })
  @IsOptional()
  @IsString()
  mediaBase64?: string;

  @ApiPropertyOptional({
    description: 'Media MIME type',
    example: 'image/jpeg',
  })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({
    description: 'Document filename',
    example: 'document.pdf',
  })
  @IsOptional()
  @IsString()
  filename?: string;
}

export class BulkUploadResponseDto {
  @ApiProperty()
  batchId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  totalNumbers: number;

  @ApiProperty()
  validNumbers: number;

  @ApiProperty()
  invalidNumbers: number;

  @ApiPropertyOptional()
  invalidNumbersList?: string[];

  @ApiPropertyOptional()
  estimatedCompletionTime?: string;

  @ApiProperty()
  statusUrl: string;

  @ApiProperty()
  message: string;
}

export class PhoneNumberValidationResult {
  original: string;
  formatted: string | null;
  valid: boolean;
  chatId: string | null;
  error?: string;
}
