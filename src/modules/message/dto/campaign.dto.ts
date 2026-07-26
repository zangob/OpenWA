import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  ArrayMaxSize,
  MaxLength,
  IsNotEmpty,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Message template ──────────────────────────────────────────────────────

class CampaignImageDto {
  @ApiPropertyOptional({ description: 'Raw base64 or data-URI of the image' })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ description: 'Public URL of the image (alternative to base64)' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Image MIME type', example: 'image/png' })
  @IsOptional()
  @IsString()
  mimetype?: string;
}

class CampaignMessageDto {
  @ApiProperty({ enum: ['text', 'image'] })
  @IsIn(['text', 'image'])
  type: 'text' | 'image';

  @ApiPropertyOptional({ description: 'Message text / image caption. Supports {name} placeholder.' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @ApiPropertyOptional({ type: CampaignImageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignImageDto)
  image?: CampaignImageDto;
}

// ── Recipients ────────────────────────────────────────────────────────────

class CampaignNumberDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: '+628123456789' })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

class CampaignRecipientsDto {
  @ApiPropertyOptional({ type: [CampaignNumberDto], description: 'Individual phone recipients' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50000)
  @ValidateNested({ each: true })
  @Type(() => CampaignNumberDto)
  numbers?: CampaignNumberDto[];

  @ApiPropertyOptional({ description: 'Group chat ids (e.g. 123@g.us)', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  groups?: string[];
}

// ── Create draft ──────────────────────────────────────────────────────────

export class CreateCampaignDto {
  @ApiPropertyOptional({ description: 'Campaign name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ type: CampaignMessageDto })
  @ValidateNested()
  @Type(() => CampaignMessageDto)
  message: CampaignMessageDto;

  @ApiProperty({ type: CampaignRecipientsDto })
  @ValidateNested()
  @Type(() => CampaignRecipientsDto)
  recipients: CampaignRecipientsDto;

  @ApiPropertyOptional({ description: 'Default country code prepended to local numbers, e.g. +62' })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  defaultCountryCode?: string;
}

// ── Test send ─────────────────────────────────────────────────────────────

export class SendCampaignTestDto {
  @ApiProperty({ description: "Operator's own phone number to receive the test message", example: '+628123456789' })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

// ── Start ─────────────────────────────────────────────────────────────────

export class StartCampaignDto {
  @ApiProperty({ description: 'Delay between messages in seconds (min 30, max 300)', minimum: 30, maximum: 300 })
  @IsNumber()
  @Min(30)
  @Max(300)
  delaySeconds: number;

  @ApiPropertyOptional({ description: 'Add a small random jitter to each delay', default: true })
  @IsOptional()
  @IsBoolean()
  randomizeDelay?: boolean;
}
