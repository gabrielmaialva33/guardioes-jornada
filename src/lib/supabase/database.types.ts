// Mirrors the unapplied local migration. Regenerate after linking/deploying it.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type JourneyMutationReply = {
	status: 'ok' | 'conflict';
	rev: number;
	server_doc: Json | null;
	reason?: string;
};
export type JourneyRow = {
	id: string; owner_id: string; journey_id: string; school: string; class_name: string;
	visit_date: string; certificate_code: string; standings: Json; finished_at: string | null;
	doc: Json; client_updated_at: string; created_at: string; updated_at: string;
	deleted_at: string | null; rev: number; last_mutation_id: string | null;
};
export type Database = {
	public: {
		Tables: { journey_sessions: {
			Row: JourneyRow;
			Insert: Pick<JourneyRow, 'id' | 'journey_id' | 'visit_date' | 'certificate_code' | 'doc' | 'client_updated_at'> & Partial<JourneyRow>;
			Update: Partial<JourneyRow>; Relationships: [];
		} };
		Views: { [_ in never]: never };
		Functions: {
			push_journey_session: { Args: { p_row: Json; p_base_rev: number; p_mutation_id: string }; Returns: JourneyMutationReply };
			delete_journey_session: { Args: { p_id: string; p_base_rev: number; p_mutation_id: string }; Returns: JourneyMutationReply };
			verify_certificate: { Args: { code: string }; Returns: { journey_id: string; school: string; class_name: string; visit_date: string; finished_at: string; standings: Json }[] };
		};
		Enums: { [_ in never]: never }; CompositeTypes: { [_ in never]: never };
	};
};
