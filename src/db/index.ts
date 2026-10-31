import type { DataRepository } from './interface';
import { LocalDexieAdapter } from './localAdapter';
import { SupabaseAdapterStub } from './supabaseAdapter';

const adapterMode = import.meta.env?.VITE_DATA_ADAPTER ?? 'local';

export const dbRepo: DataRepository =
  adapterMode === 'supabase' ? new SupabaseAdapterStub() : new LocalDexieAdapter();

export * from './interface';
export { LocalDexieAdapter } from './localAdapter';
