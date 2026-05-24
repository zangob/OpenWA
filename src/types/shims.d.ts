// Type declaration shims for modules without @types packages

// Note: express, archiver, tar-stream, qrcode, dockerode have @types packages
// Only add shims here for modules truly missing type definitions

declare module 'papaparse' {
  interface ParseResult<T> {
    data: T[];
    errors: Array<{ message: string; row?: number }>;
    meta: {
      fields?: string[];
      delimiter: string;
      linebreak: string;
      aborted: boolean;
      truncated: boolean;
      cursor: number;
    };
  }
  interface ParseConfig<T> {
    header?: boolean;
    skipEmptyLines?: boolean;
    dynamicTyping?: boolean;
    transformHeader?: (header: string) => string;
  }
  function parse<T>(input: string, config?: ParseConfig<T>): ParseResult<T>;
  export { parse };
}

declare module 'xlsx' {
  interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  interface WorkSheet {
    [key: string]: unknown;
  }
  interface Utils {
    sheet_to_json<T>(sheet: WorkSheet, options?: { header?: number | string[] }): T[];
  }
  function read(data: Buffer, options?: { type?: 'buffer' | 'base64' | 'binary' | 'file' }): WorkBook;
  function sheet_to_json<T>(sheet: WorkSheet, options?: { header?: number | string[] }): T[];
  const utils: Utils;
  export { read, sheet_to_json, utils };
}
