import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export type ResultRow = {
  nickname: string;
  completion_time: number;
  level_type: number;
};

export async function saveResult(row: ResultRow): Promise<boolean> {
  const { error } = await supabase.from('results').insert(row);
  if (error) console.error(error);
  return !error;
}

export async function topResults(level: number, limit = 10): Promise<ResultRow[]> {
  const { data, error } = await supabase
    .from('results')
    .select('nickname, completion_time, level_type')
    .eq('level_type', level)
    .order('completion_time', { ascending: true })
    .limit(limit);
  if (error) {
    console.error(error);
    return [];
  }
  return data;
}