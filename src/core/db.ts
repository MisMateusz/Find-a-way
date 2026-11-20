import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export const getClient = (): SupabaseClient =>
  (client ??= createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  ));

export type ResultRow = {
  nick1: string;
  nick2: string;
  completion_time: number;
};

export async function saveResult(row: ResultRow, level: number): Promise<boolean> {
  try {
    const { error } = await getClient().from('results' + level).insert(row);
    if (error) console.error(error);
    return !error;
  } catch {
    return false;
  }
}

export async function topResults(level: number): Promise<ResultRow[]> {
  try {
    const { data, error } = await getClient()
      .from('results' + level)
      .select('nick1, nick2, completion_time')
      .order('completion_time', { ascending: true })
      .limit(10);
    if (error) {
      console.error(error);
      return [];
    }
    return data;
  } catch {
    return [];
  }
}

export async function realtimeAllowed(): Promise<boolean> {
  try {
    const { data, error } = await getClient().rpc('realtime_allowed');
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function countRealtimeGame(): Promise<void> {
  try {
    await getClient().rpc('realtime_count_game');
  } catch {}
}