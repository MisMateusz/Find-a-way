import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export type ResultRow = {
  nick1: string;
  nick2: string;
  completion_time: number;
};

export async function saveResult(row: ResultRow, level: number): Promise<boolean> {
  const { error } = await supabase.from('results'+level).insert(row);
  if (error) console.error(error);
  return !error;
}

export async function topResults(level: number): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('results'+level)
    .select('nick1, nick2, completion_time')
    .order('completion_time', { ascending: true })
  if (error) {
    console.error(error);
    return [];
  }
  return data;
}