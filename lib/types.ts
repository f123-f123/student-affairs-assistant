export type Category = { id: string; name: string; description: string; sort_order: number };
export type KnowledgeItem = {
  id: string;
  category_id: string;
  question: string;
  answer: string;
  source_level: number;
  source_name: string;
  source_url: string | null;
  updated_at: string;
  categories: { name: string } | null;
  source_type?: 'saved_notice';
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
export type Citation = Pick<KnowledgeItem, 'id' | 'source_name' | 'source_level' | 'updated_at' | 'source_url' | 'source_type'> & { source_text?: string };
export type AskResponse = {
  answerable: boolean;
  answer?: string;
  citations: Citation[];
  contacts: Contact[];
  category_id: string;
};

export type EventMaterial = { name: string; done: boolean; source_text: string };
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
  status: 'active' | 'done' | 'archived';
  created_at: string;
  updated_at: string;
};

export type EventDraft = Omit<StudentEvent, 'id' | 'device_id' | 'status' | 'created_at' | 'updated_at'>;
