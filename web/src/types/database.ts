export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      demo_seed_state: {
        Row: {
          demo_deleted_at: string | null
          owner_id: string
          seed_version: number
          seeded_at: string
        }
        Insert: {
          demo_deleted_at?: string | null
          owner_id: string
          seed_version: number
          seeded_at?: string
        }
        Update: {
          demo_deleted_at?: string | null
          owner_id?: string
          seed_version?: number
          seeded_at?: string
        }
        Relationships: []
      }
      encrypted_bank_settings: {
        Row: {
          ciphertext: string | null
          deleted_at: string | null
          encryption_version: number | null
          id: string
          initialization_vector: string | null
          invoice_prefix: string
          kdf_parameters: Json | null
          owner_id: string
          profile: Json
          revision: number
          salt: string | null
          updated_at: string
        }
        Insert: {
          ciphertext?: string | null
          deleted_at?: string | null
          encryption_version?: number | null
          id: string
          initialization_vector?: string | null
          invoice_prefix?: string
          kdf_parameters?: Json | null
          owner_id: string
          profile?: Json
          revision?: number
          salt?: string | null
          updated_at?: string
        }
        Update: {
          ciphertext?: string | null
          deleted_at?: string | null
          encryption_version?: number | null
          id?: string
          initialization_vector?: string | null
          invoice_prefix?: string
          kdf_parameters?: Json | null
          owner_id?: string
          profile?: Json
          revision?: number
          salt?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expense_category_records: {
        Row: {
          archived_at: string | null
          deleted_at: string | null
          id: string
          is_demo: boolean
          name: string
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          deleted_at?: string | null
          id: string
          is_demo?: boolean
          name: string
          owner_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          deleted_at?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      expense_records: {
        Row: {
          allowable_percentage: number
          amount_pence: number
          category_key: string | null
          custom_category_id: string | null
          deleted_at: string | null
          expense_date: string
          expense_kind: string
          id: string
          is_demo: boolean
          mtd_category: string
          distance_miles: number | null
          journey_destination: string | null
          journey_origin: string | null
          linked_session_id: string | null
          mileage_rate_pence: number | null
          needs_accountant_review: boolean
          notes: string | null
          owner_id: string
          practice_id: string | null
          receipt_mime_type: string | null
          receipt_object_key: string | null
          receipt_original_name: string | null
          receipt_size_bytes: number | null
          receipt_sync_status: string
          reimbursed_by_practice: boolean
          revision: number
          supplier_description: string
          updated_at: string
        }
        Insert: {
          allowable_percentage?: number
          amount_pence: number
          category_key?: string | null
          custom_category_id?: string | null
          deleted_at?: string | null
          expense_date: string
          expense_kind?: string
          id: string
          is_demo?: boolean
          mtd_category?: string
          distance_miles?: number | null
          journey_destination?: string | null
          journey_origin?: string | null
          linked_session_id?: string | null
          mileage_rate_pence?: number | null
          needs_accountant_review?: boolean
          notes?: string | null
          owner_id: string
          practice_id?: string | null
          receipt_mime_type?: string | null
          receipt_object_key?: string | null
          receipt_original_name?: string | null
          receipt_size_bytes?: number | null
          receipt_sync_status?: string
          reimbursed_by_practice?: boolean
          revision?: number
          supplier_description: string
          updated_at?: string
        }
        Update: {
          allowable_percentage?: number
          amount_pence?: number
          category_key?: string | null
          custom_category_id?: string | null
          deleted_at?: string | null
          expense_date?: string
          expense_kind?: string
          id?: string
          is_demo?: boolean
          mtd_category?: string
          distance_miles?: number | null
          journey_destination?: string | null
          journey_origin?: string | null
          linked_session_id?: string | null
          mileage_rate_pence?: number | null
          needs_accountant_review?: boolean
          notes?: string | null
          owner_id?: string
          practice_id?: string | null
          receipt_mime_type?: string | null
          receipt_object_key?: string | null
          receipt_original_name?: string | null
          receipt_size_bytes?: number | null
          receipt_sync_status?: string
          reimbursed_by_practice?: boolean
          revision?: number
          supplier_description?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_category_owner_fk"
            columns: ["owner_id", "custom_category_id"]
            isOneToOne: false
            referencedRelation: "expense_category_records"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "expense_practice_owner_fk"
            columns: ["owner_id", "practice_id"]
            isOneToOne: false
            referencedRelation: "practice_records"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          calendar_id: string
          connected_at: string
          last_failure_at: string | null
          last_failure_category: string | null
          last_sync_at: string | null
          owner_id: string
          refresh_token_envelope: Json | null
          replacement_calendar_id: string | null
          replacement_claim_token: string | null
          replacement_lease_expires_at: string | null
          replacement_started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          calendar_id: string
          connected_at: string
          last_failure_at?: string | null
          last_failure_category?: string | null
          last_sync_at?: string | null
          owner_id: string
          refresh_token_envelope?: Json | null
          replacement_calendar_id?: string | null
          replacement_claim_token?: string | null
          replacement_lease_expires_at?: string | null
          replacement_started_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          connected_at?: string
          last_failure_at?: string | null
          last_failure_category?: string | null
          last_sync_at?: string | null
          owner_id?: string
          refresh_token_envelope?: Json | null
          replacement_calendar_id?: string | null
          replacement_claim_token?: string | null
          replacement_lease_expires_at?: string | null
          replacement_started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_calendar_event_links: {
        Row: {
          calendar_id: string
          event_id: string
          last_applied_revision: number
          owner_id: string
          session_id: string
          state: string
          updated_at: string
        }
        Insert: {
          calendar_id: string
          event_id: string
          last_applied_revision: number
          owner_id: string
          session_id: string
          state: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          event_id?: string
          last_applied_revision?: number
          owner_id?: string
          session_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_event_links_owner_id_session_id_fkey"
            columns: ["owner_id", "session_id"]
            isOneToOne: true
            referencedRelation: "session_records"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      google_calendar_oauth_state_claims: {
        Row: {
          created_at: string
          expires_at: string
          owner_id: string
          state_digest: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          owner_id: string
          state_digest: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          owner_id?: string
          state_digest?: string
        }
        Relationships: []
      }
      google_calendar_owner_guards: {
        Row: {
          created_at: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          owner_id?: string
        }
        Relationships: []
      }
      google_calendar_setup_claims: {
        Row: {
          claim_token: string
          lease_expires_at: string
          owner_id: string
          staged_calendar_id: string | null
          started_at: string
          updated_at: string
        }
        Insert: {
          claim_token: string
          lease_expires_at: string
          owner_id: string
          staged_calendar_id?: string | null
          started_at: string
          updated_at: string
        }
        Update: {
          claim_token?: string
          lease_expires_at?: string
          owner_id?: string
          staged_calendar_id?: string | null
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_calendar_sync_jobs: {
        Row: {
          attempts: number
          claim_token: string | null
          claimed_action: string | null
          claimed_revision: number | null
          desired_action: string
          last_failure_category: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          owner_id: string
          session_id: string
          target_revision: number
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          claimed_action?: string | null
          claimed_revision?: number | null
          desired_action: string
          last_failure_category?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          owner_id: string
          session_id: string
          target_revision: number
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          claimed_action?: string | null
          claimed_revision?: number | null
          desired_action?: string
          last_failure_category?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          owner_id?: string
          session_id?: string
          target_revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_sync_jobs_owner_id_session_id_fkey"
            columns: ["owner_id", "session_id"]
            isOneToOne: true
            referencedRelation: "session_records"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      invoice_item_records: {
        Row: {
          deleted_at: string | null
          description: string
          id: string
          invoice_id: string
          is_demo: boolean
          line_total_pence: number
          owner_id: string
          quantity: number
          revision: number
          session_id: string | null
          unit_rate_pence: number
          updated_at: string
        }
        Insert: {
          deleted_at?: string | null
          description: string
          id: string
          invoice_id: string
          is_demo?: boolean
          line_total_pence: number
          owner_id: string
          quantity: number
          revision?: number
          session_id?: string | null
          unit_rate_pence: number
          updated_at?: string
        }
        Update: {
          deleted_at?: string | null
          description?: string
          id?: string
          invoice_id?: string
          is_demo?: boolean
          line_total_pence?: number
          owner_id?: string
          quantity?: number
          revision?: number
          session_id?: string | null
          unit_rate_pence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_item_records_invoice_owner_fk"
            columns: ["owner_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_records"
            referencedColumns: ["owner_id", "id"]
          },
          {
            foreignKeyName: "invoice_item_records_session_owner_fk"
            columns: ["owner_id", "session_id"]
            isOneToOne: false
            referencedRelation: "session_records"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      invoice_records: {
        Row: {
          artifact_path: string | null
          deleted_at: string | null
          due_date: string | null
          id: string
          invoice_number: string | null
          is_demo: boolean
          issue_date: string | null
          issued_at: string | null
          owner_id: string
          paid_at: string | null
          payment_snapshot: Json | null
          practice_id: string | null
          practice_snapshot: Json | null
          revision: number
          status: string
          total_pence: number
          updated_at: string
        }
        Insert: {
          artifact_path?: string | null
          deleted_at?: string | null
          due_date?: string | null
          id: string
          invoice_number?: string | null
          is_demo?: boolean
          issue_date?: string | null
          issued_at?: string | null
          owner_id: string
          paid_at?: string | null
          payment_snapshot?: Json | null
          practice_id?: string | null
          practice_snapshot?: Json | null
          revision?: number
          status?: string
          total_pence?: number
          updated_at?: string
        }
        Update: {
          artifact_path?: string | null
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          is_demo?: boolean
          issue_date?: string | null
          issued_at?: string | null
          owner_id?: string
          paid_at?: string | null
          payment_snapshot?: Json | null
          practice_id?: string | null
          practice_snapshot?: Json | null
          revision?: number
          status?: string
          total_pence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_records_practice_owner_fk"
            columns: ["owner_id", "practice_id"]
            isOneToOne: false
            referencedRelation: "practice_records"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          invoice_year: number
          last_value: number
          owner_id: string
          updated_at: string
        }
        Insert: {
          invoice_year: number
          last_value?: number
          owner_id: string
          updated_at?: string
        }
        Update: {
          invoice_year?: number
          last_value?: number
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      practice_records: {
        Row: {
          archived: boolean
          billing_address: Json
          default_hourly_rate_pence: number
          deleted_at: string | null
          id: string
          is_demo: boolean
          name: string
          owner_id: string
          payment_terms_days: number
          revision: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          billing_address?: Json
          default_hourly_rate_pence?: number
          deleted_at?: string | null
          id: string
          is_demo?: boolean
          name: string
          owner_id: string
          payment_terms_days?: number
          revision?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          billing_address?: Json
          default_hourly_rate_pence?: number
          deleted_at?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          owner_id?: string
          payment_terms_days?: number
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: string
          created_at: string
          deleted_at: string | null
          id: string
          last_sign_in_at: string | null
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          account_status?: string
          created_at?: string
          deleted_at?: string | null
          id: string
          last_sign_in_at?: string | null
          owner_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          account_status?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_sign_in_at?: string | null
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      session_records: {
        Row: {
          deleted_at: string | null
          ends_at: string
          hourly_rate_pence: number
          id: string
          is_demo: boolean
          notes: string | null
          owner_id: string
          practice_id: string
          revision: number
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          deleted_at?: string | null
          ends_at: string
          hourly_rate_pence: number
          id: string
          is_demo?: boolean
          notes?: string | null
          owner_id: string
          practice_id: string
          revision?: number
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          deleted_at?: string | null
          ends_at?: string
          hourly_rate_pence?: number
          id?: string
          is_demo?: boolean
          notes?: string | null
          owner_id?: string
          practice_id?: string
          revision?: number
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_records_practice_owner_fk"
            columns: ["owner_id", "practice_id"]
            isOneToOne: false
            referencedRelation: "practice_records"
            referencedColumns: ["owner_id", "id"]
          },
        ]
      }
      sync_health: {
        Row: {
          application_error_count: number
          deleted_at: string | null
          failed_sync_count: number
          id: string
          last_error_at: string | null
          last_sync_at: string | null
          owner_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          application_error_count?: number
          deleted_at?: string | null
          failed_sync_count?: number
          id: string
          last_error_at?: string | null
          last_sync_at?: string | null
          owner_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          application_error_count?: number
          deleted_at?: string | null
          failed_sync_count?: number
          id?: string
          last_error_at?: string | null
          last_sync_at?: string | null
          owner_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      sync_mutation_receipts: {
        Row: {
          applied_at: string
          deleted_at: string | null
          id: string
          idempotency_key: string
          mutation_type: string
          owner_id: string
          result: Json
          revision: number
          updated_at: string
        }
        Insert: {
          applied_at?: string
          deleted_at?: string | null
          id: string
          idempotency_key: string
          mutation_type: string
          owner_id: string
          result?: Json
          revision?: number
          updated_at?: string
        }
        Update: {
          applied_at?: string
          deleted_at?: string | null
          id?: string
          idempotency_key?: string
          mutation_type?: string
          owner_id?: string
          result?: Json
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_account_health: {
        Row: {
          account_id: string | null
          application_error_count: number | null
          created_at: string | null
          failed_sync_count: number | null
          last_sign_in_at: string | null
          last_sync_at: string | null
          status: string | null
        }
        Relationships: []
      }
      admin_google_calendar_health: {
        Row: {
          account_id: string | null
          connection_status: string | null
          last_failure_at: string | null
          last_sync_at: string | null
          pending_job_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_google_calendar_replacement: {
        Args: {
          claimed_at: string
          requested_calendar: string
          requested_claim: string
          requested_owner: string
        }
        Returns: {
          calendar_id: string
          disposition: string
        }[]
      }
      claim_google_calendar_setup: {
        Args: {
          claimed_at: string
          requested_claim: string
          requested_owner: string
        }
        Returns: {
          calendar_id: string
          disposition: string
        }[]
      }
      claim_google_calendar_sync_jobs: {
        Args: {
          claimed_at: string
          lease_until: string
          requested_limit: number
          requested_owner: string
        }
        Returns: {
          attempts: number
          claim_token: string
          desired_action: string
          lease_expires_at: string
          next_attempt_at: string
          owner_id: string
          session_id: string
          target_revision: number
        }[]
      }
      complete_google_calendar_delete: {
        Args: {
          completed_at: string
          requested_calendar: string
          requested_claim: string
          requested_owner: string
          requested_revision: number
          requested_session: string
        }
        Returns: string
      }
      complete_google_calendar_replacement: {
        Args: {
          completed_at: string
          requested_calendar: string
          requested_claim: string
          requested_owner: string
          requested_replacement: string
        }
        Returns: string
      }
      complete_google_calendar_setup: {
        Args: {
          completed_at: string
          requested_calendar: string
          requested_claim: string
          requested_envelope: Json
          requested_owner: string
        }
        Returns: string
      }
      complete_google_calendar_upsert: {
        Args: {
          completed_at: string
          requested_calendar: string
          requested_claim: string
          requested_event: string
          requested_owner: string
          requested_revision: number
          requested_session: string
          requested_state: string
        }
        Returns: string
      }
      current_user_can_access_expense_receipt: {
        Args: { object_name: string }
        Returns: boolean
      }
      current_user_is_admin: { Args: never; Returns: boolean }
      delete_owned_demo_data: {
        Args: never
        Returns: {
          object_key: string
        }[]
      }
      issue_invoice: {
        Args: {
          requested_invoice_id: string
          requested_issue_date: string
          requested_items: Json
          requested_payment_snapshot: Json
          requested_practice_id: string
          requested_prefix?: string
        }
        Returns: {
          artifact_path: string | null
          deleted_at: string | null
          due_date: string | null
          id: string
          invoice_number: string | null
          is_demo: boolean
          issue_date: string | null
          issued_at: string | null
          owner_id: string
          paid_at: string | null
          payment_snapshot: Json | null
          practice_id: string | null
          practice_snapshot: Json | null
          revision: number
          status: string
          total_pence: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "invoice_records"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      release_google_calendar_replacement: {
        Args: {
          released_at: string
          requested_calendar: string
          requested_claim: string
          requested_owner: string
        }
        Returns: boolean
      }
      release_google_calendar_setup: {
        Args: { requested_claim: string; requested_owner: string }
        Returns: boolean
      }
      retry_google_calendar_sync_job: {
        Args: {
          failed_at: string
          requested_category: string
          requested_claim: string
          requested_owner: string
          requested_retry_at: string
          requested_session: string
        }
        Returns: string
      }
      stage_google_calendar_replacement: {
        Args: {
          requested_calendar: string
          requested_claim: string
          requested_owner: string
          requested_replacement: string
          staged_at: string
        }
        Returns: boolean
      }
      stage_google_calendar_setup: {
        Args: {
          requested_calendar: string
          requested_claim: string
          requested_owner: string
          staged_at: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
