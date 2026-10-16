export type Category = { id: string; name: string; description: string; sort_order: number };
export type KnowledgeItem = {
  id: string;
  category_id: string;
  question: string;
  answer: string;
  source_level: number;
  source_name: string;
  source_url: string | null;
  source_excerpt?: string | null;
  aliases?: string[];
  valid_from?: string | null;
  valid_until?: string | null;
  version?: number;
  supersedes?: string | null;
  status?: 'draft' | 'confirmed' | 'superseded' | 'inactive';
  updated_at: string;
  categories: { name: string } | null;
};
export type Contact = {
  id: string;
  name: string;
  role: 'teacher' | 'student_leader';
  phone: string | null;
  email: string | null;
  office: string | null;
  office_hours: string | null;
};
export type Citation = Pick<KnowledgeItem, 'id' | 'source_name' | 'source_level' | 'updated_at' | 'source_url'> & { version: number; question: string; answer: string; source_excerpt: string | null };
export type AskResponse = {
  answerable: boolean;
  answer?: string;
  notice?: string;
  citations: Citation[];
  contacts: Contact[];
  category_id: string | null;
};

export type EventMaterial = { name: string; done: boolean; source_text: string };
export type NoticeAttachment = { name: string; url: string; format: string; status: 'unparsed' };
export type StudentEvent = {
  id: string;
  device_id: string;
  title: string;
  summary: string;
  eligibility: string;
  deadline: string | null;
  deadline_source_text: string | null;
  deadline_inferred: boolean;
  submit_to: string;
  materials: EventMaterial[];
  source_url: string | null;
  source_text: string;
  publish_date: string | null;
  source_article_id?: string | null;
  source_fetched_at?: string | null;
  source_confirmed_at?: string | null;
  publish_date_source?: 'page' | 'user' | 'unknown' | null;
  status: 'active' | 'done' | 'archived';
  created_at: string;
  updated_at: string;
};

export type EventDraft = Omit<StudentEvent, 'id' | 'device_id' | 'status' | 'created_at' | 'updated_at'>;
