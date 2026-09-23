import type { Page } from 'playwright';

export interface PageReader {
  use<T>(action: (page: Page) => Promise<T>): Promise<T>;
  navigate(url: string): Promise<void>;
}
