import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { PhoneColumnType, PhoneNumberValidationResult } from './dto/bulk-upload.dto';

export interface ParsedPhoneNumber {
  original: string;
  formatted: string;
  chatId: string;
  rowData: Record<string, string>;
}

@Injectable()
export class BulkUploadService {
  private readonly logger = new Logger(BulkUploadService.name);

  /**
   * Parse file buffer and extract phone numbers
   */
  parseFile(
    fileBuffer: Buffer,
    mimeType: string,
    options: {
      phoneColumn?: PhoneColumnType | string;
      customColumnName?: string;
      skipRows?: number;
      maxNumbers?: number;
    } = {},
  ): { numbers: ParsedPhoneNumber[]; invalid: PhoneNumberValidationResult[]; headers: string[] } {
    let data: Record<string, string>[] = [];
    let headers: string[] = [];

    try {
      // Parse based on file type
      if (mimeType.includes('csv') || mimeType.includes('text/csv')) {
        const result = this.parseCSV(fileBuffer, options.skipRows || 0);
        data = result.data;
        headers = result.headers;
      } else if (
        mimeType.includes('excel') ||
        mimeType.includes('spreadsheet') ||
        mimeType.includes('xlsx') ||
        mimeType.includes('xls')
      ) {
        const result = this.parseExcel(fileBuffer, options.skipRows || 0);
        data = result.data;
        headers = result.headers;
      } else {
        throw new BadRequestException(`Unsupported file type: ${mimeType}. Use CSV or Excel files.`);
      }

      // Determine phone column name
      const phoneColumnName = this.getPhoneColumnName(headers, options.phoneColumn, options.customColumnName);
      
      if (!phoneColumnName) {
        throw new BadRequestException(
          `Could not find phone number column. Available columns: ${headers.join(', ')}. ` +
          `Please specify phoneColumn or customColumnName.`,
        );
      }

      this.logger.log(`Using phone column: ${phoneColumnName}, found ${data.length} rows`);

      // Extract and validate phone numbers
      const numbers: ParsedPhoneNumber[] = [];
      const invalid: PhoneNumberValidationResult[] = [];
      const maxNumbers = options.maxNumbers || 0;

      for (let i = 0; i < data.length; i++) {
        if (maxNumbers > 0 && numbers.length >= maxNumbers) {
          this.logger.log(`Reached max numbers limit: ${maxNumbers}`);
          break;
        }

        const row = data[i];
        const rawPhone = row[phoneColumnName];

        if (!rawPhone || typeof rawPhone !== 'string') {
          invalid.push({
            original: String(rawPhone || ''),
            formatted: null,
            valid: false,
            chatId: null,
            error: `Row ${i + 1}: Empty or invalid phone value`,
          });
          continue;
        }

        const validation = this.validateAndFormatPhone(rawPhone.trim());
        
        if (validation.valid) {
          numbers.push({
            original: rawPhone.trim(),
            formatted: validation.formatted!,
            chatId: validation.chatId!,
            rowData: row,
          });
        } else {
          invalid.push(validation);
        }
      }

      this.logger.log(`Parsed ${numbers.length} valid numbers, ${invalid.length} invalid`);

      return { numbers, invalid, headers };
    } catch (error) {
      this.logger.error('Failed to parse file', error);
      throw new BadRequestException(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse CSV file
   */
  private parseCSV(buffer: Buffer, skipRows: number): { data: Record<string, string>[]; headers: string[] } {
    const csvText = buffer.toString('utf-8');
    
    const result = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header: string) => header.trim().toLowerCase(),
    });

    if (result.errors.length > 0) {
      this.logger.warn('CSV parsing errors', result.errors);
    }

    // Skip rows if needed
    let data = result.data;
    if (skipRows > 0) {
      data = data.slice(skipRows);
    }

    const headers = result.meta.fields || [];

    return { data, headers };
  }

  /**
   * Parse Excel file
   */
  private parseExcel(buffer: Buffer, skipRows: number): { data: Record<string, string>[]; headers: string[] } {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    // Use first sheet
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) {
      throw new BadRequestException('Excel file has no sheets');
    }

    // Convert to JSON
    const rawData: unknown[] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    
    if (rawData.length === 0) {
      return { data: [], headers: [] };
    }

    // Extract headers (first row)
    const headers = ((rawData[0] || []) as string[]).map(h => String(h).trim().toLowerCase());

    // Skip header + additional rows if needed
    const startRow = 1 + skipRows;
    const rows = rawData.slice(startRow) as unknown[][];

    // Convert rows to objects
    const data: Record<string, string>[] = rows.map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = String(row[index] || '');
      });
      return obj;
    });

    return { data, headers };
  }

  /**
   * Determine phone column name from headers
   */
  private getPhoneColumnName(
    headers: string[],
    phoneColumn?: PhoneColumnType | string,
    customColumnName?: string,
  ): string | null {
    if (customColumnName) {
      const customLower = customColumnName.toLowerCase();
      return headers.find(h => h.toLowerCase() === customLower) || null;
    }

    // Common phone column names by type
    const columnMappings: Record<PhoneColumnType, string[]> = {
      [PhoneColumnType.PHONE]: ['phone', 'phone_number', 'phonenumber', 'mobile', 'cell', 'tel', 'telephone'],
      [PhoneColumnType.MOBILE]: ['mobile', 'mobile_number', 'mobilenumber', 'cell', 'cellphone', 'cell_phone'],
      [PhoneColumnType.NUMBER]: ['number', 'num', 'contact_number', 'contact', 'id'],
      [PhoneColumnType.WHATSAPP]: ['whatsapp', 'wa_number', 'wa', 'whatsapp_number', 'waid'],
      [PhoneColumnType.CUSTOM]: [],
    };

    if (phoneColumn && phoneColumn !== PhoneColumnType.CUSTOM) {
      const possibleNames = columnMappings[phoneColumn as PhoneColumnType];
      return headers.find(h => possibleNames.includes(h.toLowerCase())) || null;
    }

    // Auto-detect: try all common names
    const allPossibleNames = [
      ...columnMappings[PhoneColumnType.PHONE],
      ...columnMappings[PhoneColumnType.MOBILE],
      ...columnMappings[PhoneColumnType.NUMBER],
      ...columnMappings[PhoneColumnType.WHATSAPP],
    ];
    
    return headers.find(h => allPossibleNames.includes(h.toLowerCase())) || null;
  }

  /**
   * Validate and format phone number
   */
  private validateAndFormatPhone(rawPhone: string): PhoneNumberValidationResult {
    // Remove all non-numeric characters except + at start
    let cleaned = rawPhone.replace(/\s/g, '').replace(/[()-]/g, '');
    
    // Handle country code
    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }
    
    // Remove leading zeros if more than 10 digits (likely already has country code)
    if (cleaned.length > 10 && cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }

    // Basic validation
    if (!/^\d+$/.test(cleaned)) {
      return {
        original: rawPhone,
        formatted: null,
        valid: false,
        chatId: null,
        error: 'Contains non-numeric characters',
      };
    }

    if (cleaned.length < 7) {
      return {
        original: rawPhone,
        formatted: null,
        valid: false,
        chatId: null,
        error: 'Too short (min 7 digits)',
      };
    }

    if (cleaned.length > 15) {
      return {
        original: rawPhone,
        formatted: null,
        valid: false,
        chatId: null,
        error: 'Too long (max 15 digits)',
      };
    }

    // Format with country code if not present (assume based on length)
    let formatted = cleaned;
    if (cleaned.length <= 10 && cleaned.length >= 9) {
      // No country code, will need to add one later
      formatted = cleaned;
    }

    // Create WhatsApp chat ID
    const chatId = `${formatted}@c.us`;

    return {
      original: rawPhone,
      formatted: formatted,
      valid: true,
      chatId,
    };
  }

  /**
   * Add country code to numbers that need it
   */
  addCountryCode(numbers: ParsedPhoneNumber[], countryCode: string): ParsedPhoneNumber[] {
    if (!countryCode) {
      return numbers;
    }

    // Clean country code
    let code = countryCode.trim();
    if (code.startsWith('+')) {
      code = code.substring(1);
    }

    return numbers.map(num => {
      // Check if already has country code
      if (num.formatted.length > 10) {
        return num;
      }

      const formatted = code + num.formatted;
      return {
        ...num,
        formatted,
        chatId: `${formatted}@c.us`,
      };
    });
  }

  /**
   * Apply template variables to text
   */
  applyVariables(text: string, rowData: Record<string, string>): string {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      const lowerKey = key.toLowerCase();
      // Try exact match first
      if (rowData[key] !== undefined) {
        return rowData[key];
      }
      // Try lowercase match
      if (rowData[lowerKey] !== undefined) {
        return rowData[lowerKey];
      }
      // Try to find in headers (case insensitive)
      for (const [header, value] of Object.entries(rowData)) {
        if (header.toLowerCase() === lowerKey) {
          return value;
        }
      }
      return match; // Keep original if not found
    });
  }
}
