export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_code_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          position: number
          schedule_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          position?: number
          schedule_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_code_types_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_code_values: {
        Row: {
          code: string
          color: string | null
          created_at: string
          description: string | null
          id: string
          position: number
          type_id: string
          updated_at: string
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          type_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_code_values_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "activity_code_types"
            referencedColumns: ["id"]
          },
        ]
      }
      aos_addons: {
        Row: {
          created_at: string
          current_period_end: string | null
          email: string
          id: string
          kind: string
          metadata: Json
          price_id: string | null
          quantity: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          email: string
          id?: string
          kind: string
          metadata?: Json
          price_id?: string | null
          quantity?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          email?: string
          id?: string
          kind?: string
          metadata?: Json
          price_id?: string | null
          quantity?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      aos_links: {
        Row: {
          aos_company_id: string | null
          aos_email: string | null
          company_id: string | null
          created_at: string
          last_sync_at: string | null
          link_code: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          aos_company_id?: string | null
          aos_email?: string | null
          company_id?: string | null
          created_at?: string
          last_sync_at?: string | null
          link_code?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          aos_company_id?: string | null
          aos_email?: string | null
          company_id?: string | null
          created_at?: string
          last_sync_at?: string | null
          link_code?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      ask_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ask_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_threads: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          source: string
          summary: string | null
          summary_message_count: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          source?: string
          summary?: string | null
          summary_message_count?: number
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          source?: string
          summary?: string | null
          summary_message_count?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      call_topics: {
        Row: {
          already_tried: string | null
          created_at: string
          decision_avoided: string | null
          financial_consequence: string | null
          id: string
          kind: string
          needs_pressure: string | null
          notified_user_at: string | null
          selected_at: string | null
          selected_for_session_date: string | null
          status: string
          title: string
          updated_at: string
          user_email: string
          user_id: string
          user_name: string | null
          win_looks_like: string | null
        }
        Insert: {
          already_tried?: string | null
          created_at?: string
          decision_avoided?: string | null
          financial_consequence?: string | null
          id?: string
          kind: string
          needs_pressure?: string | null
          notified_user_at?: string | null
          selected_at?: string | null
          selected_for_session_date?: string | null
          status?: string
          title: string
          updated_at?: string
          user_email: string
          user_id: string
          user_name?: string | null
          win_looks_like?: string | null
        }
        Update: {
          already_tried?: string | null
          created_at?: string
          decision_avoided?: string | null
          financial_consequence?: string | null
          id?: string
          kind?: string
          needs_pressure?: string | null
          notified_user_at?: string | null
          selected_at?: string | null
          selected_for_session_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_email?: string
          user_id?: string
          user_name?: string | null
          win_looks_like?: string | null
        }
        Relationships: []
      }
      circle_audience_sync: {
        Row: {
          attempts: number
          email: string
          last_error: string | null
          revision: number
          status: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          email: string
          last_error?: string | null
          revision?: number
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          email?: string
          last_error?: string | null
          revision?: number
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      circle_calendar_attempts: {
        Row: {
          attempt_id: string | null
          attempted_at: string | null
          cadence_date: string
          calendar_event_id: string | null
          calendar_id: string
          created_at: string
          marker: string
          session_id: string | null
          source_cadence_date: string
          source_event_id: string
          source_meeting_url: string
          source_session_id: string | null
          source_starts_at: string
          source_version: number | null
          starts_at: string
          state: string
          updated_at: string
        }
        Insert: {
          attempt_id?: string | null
          attempted_at?: string | null
          cadence_date: string
          calendar_event_id?: string | null
          calendar_id: string
          created_at?: string
          marker?: string
          session_id?: string | null
          source_cadence_date: string
          source_event_id: string
          source_meeting_url: string
          source_session_id?: string | null
          source_starts_at: string
          source_version?: number | null
          starts_at: string
          state?: string
          updated_at?: string
        }
        Update: {
          attempt_id?: string | null
          attempted_at?: string | null
          cadence_date?: string
          calendar_event_id?: string | null
          calendar_id?: string
          created_at?: string
          marker?: string
          session_id?: string | null
          source_cadence_date?: string
          source_event_id?: string
          source_meeting_url?: string
          source_session_id?: string | null
          source_starts_at?: string
          source_version?: number | null
          starts_at?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_calendar_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "circle_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_calendar_attempts_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "circle_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_legacy_reviews: {
        Row: {
          preserve_access: boolean
          resolution: string | null
          resolved_at: string | null
          subscription_id: string
        }
        Insert: {
          preserve_access: boolean
          resolution?: string | null
          resolved_at?: string | null
          subscription_id: string
        }
        Update: {
          preserve_access?: boolean
          resolution?: string | null
          resolved_at?: string | null
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_legacy_reviews_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_owner_grant_history: {
        Row: {
          changed_at: string
          current: Json
          grant_id: string
          id: string
          previous: Json | null
        }
        Insert: {
          changed_at?: string
          current: Json
          grant_id: string
          id?: string
          previous?: Json | null
        }
        Update: {
          changed_at?: string
          current?: Json
          grant_id?: string
          id?: string
          previous?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "circle_owner_grant_history_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "circle_owner_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_owner_grants: {
        Row: {
          email: string
          expires_at: string | null
          granted_at: string
          granted_by: string
          id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          source_subscription_id: string | null
          tier: Database["public"]["Enums"]["app_tier"]
          user_id: string | null
        }
        Insert: {
          email: string
          expires_at?: string | null
          granted_at?: string
          granted_by: string
          id?: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          source_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
          user_id?: string | null
        }
        Update: {
          email?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          source_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "circle_owner_grants_source_subscription_id_fkey"
            columns: ["source_subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_sessions: {
        Row: {
          cadence_date: string | null
          calendar_event_id: string | null
          calendar_id: string | null
          calendar_updated_at: string | null
          calendar_verification_method: string | null
          calendar_verified_at: string | null
          created_at: string
          description: string
          duration_min: number
          id: string
          kind: string
          meeting_url: string
          rollover_enabled: boolean
          starts_at: string
          status: string
          time_zone: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          cadence_date?: string | null
          calendar_event_id?: string | null
          calendar_id?: string | null
          calendar_updated_at?: string | null
          calendar_verification_method?: string | null
          calendar_verified_at?: string | null
          created_at?: string
          description?: string
          duration_min: number
          id?: string
          kind?: string
          meeting_url: string
          rollover_enabled?: boolean
          starts_at: string
          status?: string
          time_zone?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          cadence_date?: string | null
          calendar_event_id?: string | null
          calendar_id?: string | null
          calendar_updated_at?: string | null
          calendar_verification_method?: string | null
          calendar_verified_at?: string | null
          created_at?: string
          description?: string
          duration_min?: number
          id?: string
          kind?: string
          meeting_url?: string
          rollover_enabled?: boolean
          starts_at?: string
          status?: string
          time_zone?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      circle_source_alias_history: {
        Row: {
          alias_id: string
          changed_at: string
          current: Json
          id: string
          previous: Json | null
        }
        Insert: {
          alias_id: string
          changed_at?: string
          current: Json
          id?: string
          previous?: Json | null
        }
        Update: {
          alias_id?: string
          changed_at?: string
          current?: Json
          id?: string
          previous?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "circle_source_alias_history_alias_id_fkey"
            columns: ["alias_id"]
            isOneToOne: false
            referencedRelation: "circle_source_aliases"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_source_aliases: {
        Row: {
          approved_at: string
          approved_by: string
          billing_email: string
          expires_at: string | null
          id: string
          reason: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          source_email: string
          source_stripe_customer_id: string
          source_stripe_subscription_id: string
          source_subscription_id: string
          source_user_id: string | null
          target_email: string
          target_user_id: string
        }
        Insert: {
          approved_at?: string
          approved_by: string
          billing_email: string
          expires_at?: string | null
          id?: string
          reason: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source_email: string
          source_stripe_customer_id: string
          source_stripe_subscription_id: string
          source_subscription_id: string
          source_user_id?: string | null
          target_email: string
          target_user_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          billing_email?: string
          expires_at?: string | null
          id?: string
          reason?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source_email?: string
          source_stripe_customer_id?: string
          source_stripe_subscription_id?: string
          source_subscription_id?: string
          source_user_id?: string | null
          target_email?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_source_aliases_source_subscription_id_fkey"
            columns: ["source_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_subscription_evidence: {
        Row: {
          observed_at: string
          paid_through: string | null
          review_reason: string | null
          stripe_subscription_id: string
        }
        Insert: {
          observed_at: string
          paid_through?: string | null
          review_reason?: string | null
          stripe_subscription_id: string
        }
        Update: {
          observed_at?: string
          paid_through?: string | null
          review_reason?: string | null
          stripe_subscription_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          created_at: string
          greeting_icon: string | null
          id: string
          logo_path: string | null
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          greeting_icon?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          greeting_icon?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      discord_members: {
        Row: {
          discord_user_id: string
          discord_username: string | null
          email: string
          joined_guild_at: string
        }
        Insert: {
          discord_user_id: string
          discord_username?: string | null
          email: string
          joined_guild_at?: string
        }
        Update: {
          discord_user_id?: string
          discord_username?: string | null
          email?: string
          joined_guild_at?: string
        }
        Relationships: []
      }
      email_approvals: {
        Row: {
          created_at: string
          from_address: string
          html: string
          id: string
          idempotency_key: string
          message_id: string
          plain_text: string
          recipient_email: string
          requested_by: string | null
          requested_by_email: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sender_domain: string
          status: string
          subject: string
          template_data: Json
          template_name: string
          unsubscribe_token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_address: string
          html: string
          id?: string
          idempotency_key: string
          message_id: string
          plain_text: string
          recipient_email: string
          requested_by?: string | null
          requested_by_email?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_domain: string
          status?: string
          subject: string
          template_data?: Json
          template_name: string
          unsubscribe_token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_address?: string
          html?: string
          id?: string
          idempotency_key?: string
          message_id?: string
          plain_text?: string
          recipient_email?: string
          requested_by?: string | null
          requested_by_email?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_domain?: string
          status?: string
          subject?: string
          template_data?: Json
          template_name?: string
          unsubscribe_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      mcp_answers: {
        Row: {
          check_key: string
          check_version: number
          created_at: string
          detail: string | null
          id: string
          lookahead_id: string
          response: string | null
          status: string
          user_id: string
        }
        Insert: {
          check_key: string
          check_version: number
          created_at?: string
          detail?: string | null
          id?: string
          lookahead_id: string
          response?: string | null
          status: string
          user_id?: string
        }
        Update: {
          check_key?: string
          check_version?: number
          created_at?: string
          detail?: string | null
          id?: string
          lookahead_id?: string
          response?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_answers_lookahead_id_fkey"
            columns: ["lookahead_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookaheads"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_audit_log: {
        Row: {
          action: string
          actor: string
          company_id: string | null
          created_at: string
          id: number
          job_number: string | null
          object_id: string | null
          tool: string
        }
        Insert: {
          action: string
          actor: string
          company_id?: string | null
          created_at?: string
          id?: never
          job_number?: string | null
          object_id?: string | null
          tool: string
        }
        Update: {
          action?: string
          actor?: string
          company_id?: string | null
          created_at?: string
          id?: never
          job_number?: string | null
          object_id?: string | null
          tool?: string
        }
        Relationships: []
      }
      mcp_billing_allocations: {
        Row: {
          amount_cents: number
          effective_date: string
          id: string
          invoice_id: string
          job_id: string
          receipt_id: string
          recorded_at: string
          recorded_by: string
          reversal_of: string | null
          source: string
        }
        Insert: {
          amount_cents: number
          effective_date: string
          id: string
          invoice_id: string
          job_id: string
          receipt_id: string
          recorded_at?: string
          recorded_by: string
          reversal_of?: string | null
          source: string
        }
        Update: {
          amount_cents?: number
          effective_date?: string
          id?: string
          invoice_id?: string
          job_id?: string
          receipt_id?: string
          recorded_at?: string
          recorded_by?: string
          reversal_of?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "mcp_billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_allocations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "mcp_billing_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_allocations_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "mcp_billing_allocations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_document_links: {
        Row: {
          document_id: string
          invoice_id: string | null
          invoice_version: number | null
          job_id: string
          receipt_id: string | null
          recorded_at: string
          recorded_by: string
        }
        Insert: {
          document_id: string
          invoice_id?: string | null
          invoice_version?: number | null
          job_id: string
          receipt_id?: string | null
          recorded_at?: string
          recorded_by: string
        }
        Update: {
          document_id?: string
          invoice_id?: string | null
          invoice_version?: number | null
          job_id?: string
          receipt_id?: string | null
          recorded_at?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_document_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "mcp_billing_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_document_links_invoice_id_invoice_version_fkey"
            columns: ["invoice_id", "invoice_version"]
            isOneToOne: false
            referencedRelation: "mcp_billing_invoice_versions"
            referencedColumns: ["invoice_id", "version"]
          },
          {
            foreignKeyName: "mcp_billing_document_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_document_links_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "mcp_billing_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_documents: {
        Row: {
          company_id: string
          created_by: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          recorded_at: string
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          company_id: string
          created_by: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          recorded_at?: string
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          company_id?: string
          created_by?: string
          filename?: string
          id?: string
          job_id?: string
          mime_type?: string
          recorded_at?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_documents_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "mcp_billing_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_invoice_versions: {
        Row: {
          certified_cents: number | null
          certified_date: string | null
          effective_date: string
          gross_cents: number | null
          invoice_date: string
          invoice_id: string
          job_id: string
          net_due_cents: number
          period_end: string | null
          period_start: string | null
          reason: string | null
          recorded_at: string
          recorded_by: string
          released_cents: number | null
          source: string
          status: string
          version: number
          withheld_cents: number | null
        }
        Insert: {
          certified_cents?: number | null
          certified_date?: string | null
          effective_date: string
          gross_cents?: number | null
          invoice_date: string
          invoice_id: string
          job_id: string
          net_due_cents: number
          period_end?: string | null
          period_start?: string | null
          reason?: string | null
          recorded_at?: string
          recorded_by: string
          released_cents?: number | null
          source: string
          status: string
          version: number
          withheld_cents?: number | null
        }
        Update: {
          certified_cents?: number | null
          certified_date?: string | null
          effective_date?: string
          gross_cents?: number | null
          invoice_date?: string
          invoice_id?: string
          job_id?: string
          net_due_cents?: number
          period_end?: string | null
          period_start?: string | null
          reason?: string | null
          recorded_at?: string
          recorded_by?: string
          released_cents?: number | null
          source?: string
          status?: string
          version?: number
          withheld_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_invoice_versions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "mcp_billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_invoice_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_invoices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          credit_for: string | null
          document_number: string
          id: string
          job_id: string
          kind: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          credit_for?: string | null
          document_number: string
          id: string
          job_id: string
          kind: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          credit_for?: string | null
          document_number?: string
          id?: string
          job_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_invoices_credit_for_fkey"
            columns: ["credit_for"]
            isOneToOne: false
            referencedRelation: "mcp_billing_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_operations: {
        Row: {
          actor_id: string
          job_id: string
          recorded_at: string
          request_id: string
          result: Json
          signature: string
        }
        Insert: {
          actor_id: string
          job_id: string
          recorded_at?: string
          request_id: string
          result: Json
          signature: string
        }
        Update: {
          actor_id?: string
          job_id?: string
          recorded_at?: string
          request_id?: string
          result?: Json
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_operations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_receipt_reversals: {
        Row: {
          amount_cents: number
          effective_date: string
          id: string
          job_id: string
          receipt_id: string
          recorded_at: string
          recorded_by: string
          source: string
        }
        Insert: {
          amount_cents: number
          effective_date: string
          id: string
          job_id: string
          receipt_id: string
          recorded_at?: string
          recorded_by: string
          source: string
        }
        Update: {
          amount_cents?: number
          effective_date?: string
          id?: string
          job_id?: string
          receipt_id?: string
          recorded_at?: string
          recorded_by?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_receipt_reversals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_billing_receipt_reversals_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "mcp_billing_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_receipts: {
        Row: {
          amount_cents: number
          company_id: string
          id: string
          job_id: string
          receipt_date: string
          recorded_at: string
          recorded_by: string
          source: string
        }
        Insert: {
          amount_cents: number
          company_id: string
          id: string
          job_id: string
          receipt_date: string
          recorded_at?: string
          recorded_by: string
          source: string
        }
        Update: {
          amount_cents?: number
          company_id?: string
          id?: string
          job_id?: string
          receipt_date?: string
          recorded_at?: string
          recorded_by?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_receipts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_billing_uploads: {
        Row: {
          attempts: number
          company_id: string
          created_at: string
          created_by: string
          expires_at: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          status: string
          storage_path: string
          token_hash: string
        }
        Insert: {
          attempts?: number
          company_id: string
          created_at?: string
          created_by: string
          expires_at: string
          filename: string
          id?: string
          job_id: string
          mime_type: string
          status?: string
          storage_path: string
          token_hash: string
        }
        Update: {
          attempts?: number
          company_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          filename?: string
          id?: string
          job_id?: string
          mime_type?: string
          status?: string
          storage_path?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_billing_uploads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_board_link_opens: {
        Row: {
          id: string
          job_id: string
          link_id: string
          opened_at: string
          page: string
        }
        Insert: {
          id?: string
          job_id: string
          link_id: string
          opened_at?: string
          page: string
        }
        Update: {
          id?: string
          job_id?: string
          link_id?: string
          opened_at?: string
          page?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_board_link_opens_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "mcp_board_links"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_board_links: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          job_id: string
          last_viewed_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          scope: string
          token_hash: string
          view_count: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string
          expires_at: string
          id?: string
          job_id: string
          last_viewed_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope: string
          token_hash: string
          view_count?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          job_id?: string
          last_viewed_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: string
          token_hash?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_board_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_call_log: {
        Row: {
          called_at: string
          company_id: string | null
          id: number
          job_number: string | null
          tool: string
          user_id: string
        }
        Insert: {
          called_at?: string
          company_id?: string | null
          id?: number
          job_number?: string | null
          tool?: string
          user_id?: string
        }
        Update: {
          called_at?: string
          company_id?: string | null
          id?: number
          job_number?: string | null
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_call_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_carry_forwards: {
        Row: {
          created_at: string
          from_lookahead_id: string
          id: string
          item_id: string
          to_lookahead_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_lookahead_id: string
          id?: string
          item_id: string
          to_lookahead_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          from_lookahead_id?: string
          id?: string
          item_id?: string
          to_lookahead_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_carry_forwards_from_lookahead_id_fkey"
            columns: ["from_lookahead_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookaheads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_carry_forwards_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "mcp_open_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_carry_forwards_to_lookahead_id_fkey"
            columns: ["to_lookahead_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookaheads"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_change_history: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          job_id: string
          record_version: number
          snapshot: Json
          submittal_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          job_id: string
          record_version: number
          snapshot: Json
          submittal_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          job_id?: string
          record_version?: number
          snapshot?: Json
          submittal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_change_history_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_change_history_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_change_operations: {
        Row: {
          actor_id: string
          created_at: string
          digest: string
          job_id: string
          request_id: string
          submittal_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          digest: string
          job_id: string
          request_id: string
          submittal_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          digest?: string
          job_id?: string
          request_id?: string
          submittal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_change_operations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_change_operations_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_change_orders: {
        Row: {
          details: Json
          job_id: string
          submittal_id: string
          updated_at: string
        }
        Insert: {
          details: Json
          job_id: string
          submittal_id: string
          updated_at?: string
        }
        Update: {
          details?: Json
          job_id?: string
          submittal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_change_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_change_orders_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: true
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_checklist_items: {
        Row: {
          active: boolean
          applies_when: Json
          category: string
          created_at: string
          display_label: string | null
          id: string
          is_placeholder: boolean
          key: string
          module: string
          no_is_gap: boolean
          no_recommendation: string | null
          position: number
          prompt: string
          record_ref: string | null
          required_inputs: string[]
          rule_type: string
          section: string | null
          sets_flag: string | null
          severity: string
          superseded_at: string | null
          superseded_reason: string | null
          trade: string
          version: number
        }
        Insert: {
          active?: boolean
          applies_when?: Json
          category: string
          created_at?: string
          display_label?: string | null
          id?: string
          is_placeholder?: boolean
          key: string
          module?: string
          no_is_gap?: boolean
          no_recommendation?: string | null
          position?: number
          prompt: string
          record_ref?: string | null
          required_inputs?: string[]
          rule_type: string
          section?: string | null
          sets_flag?: string | null
          severity?: string
          superseded_at?: string | null
          superseded_reason?: string | null
          trade?: string
          version?: number
        }
        Update: {
          active?: boolean
          applies_when?: Json
          category?: string
          created_at?: string
          display_label?: string | null
          id?: string
          is_placeholder?: boolean
          key?: string
          module?: string
          no_is_gap?: boolean
          no_recommendation?: string | null
          position?: number
          prompt?: string
          record_ref?: string | null
          required_inputs?: string[]
          rule_type?: string
          section?: string | null
          sets_flag?: string | null
          severity?: string
          superseded_at?: string | null
          superseded_reason?: string | null
          trade?: string
          version?: number
        }
        Relationships: []
      }
      mcp_circle_provisioning: {
        Row: {
          company_id: string
          created_at: string
          display_name: string
          override_by: string | null
          override_reason: string | null
          override_until: string | null
          owner_user_id: string | null
          payment_claimed_at: string | null
          payment_email: string
          payment_user_id: string | null
          source_subscription_id: string
          state: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          display_name: string
          override_by?: string | null
          override_reason?: string | null
          override_until?: string | null
          owner_user_id?: string | null
          payment_claimed_at?: string | null
          payment_email: string
          payment_user_id?: string | null
          source_subscription_id: string
          state: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          display_name?: string
          override_by?: string | null
          override_reason?: string | null
          override_until?: string | null
          owner_user_id?: string | null
          payment_claimed_at?: string | null
          payment_email?: string
          payment_user_id?: string | null
          source_subscription_id?: string
          state?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_circle_provisioning_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_circle_provisioning_source_subscription_id_fkey"
            columns: ["source_subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_circle_provisioning_audit: {
        Row: {
          current: Json
          id: number
          previous: Json | null
          recorded_at: string
          source_subscription_id: string
        }
        Insert: {
          current: Json
          id?: never
          previous?: Json | null
          recorded_at?: string
          source_subscription_id: string
        }
        Update: {
          current?: Json
          id?: never
          previous?: Json | null
          recorded_at?: string
          source_subscription_id?: string
        }
        Relationships: []
      }
      mcp_companies: {
        Row: {
          agent_name: string
          company_role: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          decision_rights: Json
          default_flags: Json
          id: string
          is_test: boolean
          license_number: string | null
          logo_url: string | null
          name: string
          time_zone: string | null
          tool_stack: Json
          trades: string[]
          updated_at: string
          website: string | null
          work_types: string[]
        }
        Insert: {
          agent_name?: string
          company_role?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          decision_rights?: Json
          default_flags?: Json
          id?: string
          is_test?: boolean
          license_number?: string | null
          logo_url?: string | null
          name: string
          time_zone?: string | null
          tool_stack?: Json
          trades?: string[]
          updated_at?: string
          website?: string | null
          work_types?: string[]
        }
        Update: {
          agent_name?: string
          company_role?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          decision_rights?: Json
          default_flags?: Json
          id?: string
          is_test?: boolean
          license_number?: string | null
          logo_url?: string | null
          name?: string
          time_zone?: string | null
          tool_stack?: Json
          trades?: string[]
          updated_at?: string
          website?: string | null
          work_types?: string[]
        }
        Relationships: []
      }
      mcp_company_canaries: {
        Row: {
          code: string
          company_id: string
          created_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_company_canaries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_company_entitlements: {
        Row: {
          company_id: string
          extra_seats: number
          included_seats: number | null
          last_event_id: string | null
          plan: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          extra_seats?: number
          included_seats?: number | null
          last_event_id?: string | null
          plan?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          extra_seats?: number
          included_seats?: number | null
          last_event_id?: string | null
          plan?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_company_entitlements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_company_members: {
        Row: {
          company_id: string
          created_at: string
          display_name: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          display_name: string
          role: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          display_name?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_contract_clauses: {
        Row: {
          category: string
          company_id: string
          created_by: string | null
          day_type: string | null
          heading: string | null
          id: string
          job_id: string
          n_days: number | null
          parse_source: string
          section: string
          source: string
          trigger_desc: string | null
          updated_at: string
          verbatim_text: string
        }
        Insert: {
          category?: string
          company_id: string
          created_by?: string | null
          day_type?: string | null
          heading?: string | null
          id?: string
          job_id: string
          n_days?: number | null
          parse_source?: string
          section: string
          source: string
          trigger_desc?: string | null
          updated_at?: string
          verbatim_text: string
        }
        Update: {
          category?: string
          company_id?: string
          created_by?: string | null
          day_type?: string | null
          heading?: string | null
          id?: string
          job_id?: string
          n_days?: number | null
          parse_source?: string
          section?: string
          source?: string
          trigger_desc?: string | null
          updated_at?: string
          verbatim_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_contract_clauses_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_contract_documents: {
        Row: {
          body: string
          body_sha256: string
          company_id: string
          created_by: string | null
          file_sha256: string | null
          id: string
          job_id: string
          kind: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_bucket: string | null
          storage_path: string | null
          updated_at: string
          upload_id: string | null
        }
        Insert: {
          body: string
          body_sha256: string
          company_id: string
          created_by?: string | null
          file_sha256?: string | null
          id?: string
          job_id: string
          kind?: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
          upload_id?: string | null
        }
        Update: {
          body?: string
          body_sha256?: string
          company_id?: string
          created_by?: string | null
          file_sha256?: string | null
          id?: string
          job_id?: string
          kind?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_contract_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          record_id: string
          version: number
        }
        Insert: {
          approved_at?: string
          approved_by: string
          record_id: string
          version: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          record_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_approvals_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_approvals_record_id_version_fkey"
            columns: ["record_id", "version"]
            isOneToOne: true
            referencedRelation: "mcp_cost_submission_versions"
            referencedColumns: ["record_id", "version"]
          },
        ]
      }
      mcp_cost_business_approvals: {
        Row: {
          allocated_cents: number
          approved_at: string
          approved_by: string
          basis: string
          bill_total_cents: number
          id: string
          job_id: string
          notes: string | null
          record_id: string
          version: number
        }
        Insert: {
          allocated_cents: number
          approved_at?: string
          approved_by: string
          basis: string
          bill_total_cents: number
          id?: string
          job_id: string
          notes?: string | null
          record_id: string
          version: number
        }
        Update: {
          allocated_cents?: number
          approved_at?: string
          approved_by?: string
          basis?: string
          bill_total_cents?: number
          id?: string
          job_id?: string
          notes?: string | null
          record_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_business_approvals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_business_approvals_record_id_version_fkey"
            columns: ["record_id", "version"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submission_versions"
            referencedColumns: ["record_id", "version"]
          },
        ]
      }
      mcp_cost_business_withdrawals: {
        Row: {
          approval_id: string
          reason: string
          withdrawn_at: string
          withdrawn_by: string
        }
        Insert: {
          approval_id: string
          reason: string
          withdrawn_at?: string
          withdrawn_by: string
        }
        Update: {
          approval_id?: string
          reason?: string
          withdrawn_at?: string
          withdrawn_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_business_withdrawals_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: true
            referencedRelation: "mcp_cost_business_approvals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_payment_corrections: {
        Row: {
          corrected_at: string
          corrected_by: string
          id: string
          payment_id: string | null
          reason: string
          shared_payment_id: string | null
        }
        Insert: {
          corrected_at?: string
          corrected_by: string
          id: string
          payment_id?: string | null
          reason: string
          shared_payment_id?: string | null
        }
        Update: {
          corrected_at?: string
          corrected_by?: string
          id?: string
          payment_id?: string | null
          reason?: string
          shared_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_payment_corrections_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "mcp_cost_payment_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_payment_corrections_shared_payment_id_fkey"
            columns: ["shared_payment_id"]
            isOneToOne: true
            referencedRelation: "mcp_cost_shared_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_payment_evidence: {
        Row: {
          amount_cents: number
          id: string
          paid_on: string
          record_id: string
          recorded_at: string
          recorded_by: string
          reference: string
        }
        Insert: {
          amount_cents: number
          id: string
          paid_on: string
          record_id: string
          recorded_at?: string
          recorded_by: string
          reference: string
        }
        Update: {
          amount_cents?: number
          id?: string
          paid_on?: string
          record_id?: string
          recorded_at?: string
          recorded_by?: string
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_payment_evidence_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_posting_events: {
        Row: {
          accounting_effective_on: string | null
          posted_at: string
          posted_by: string
          record_id: string
          version: number
        }
        Insert: {
          accounting_effective_on?: string | null
          posted_at?: string
          posted_by: string
          record_id: string
          version: number
        }
        Update: {
          accounting_effective_on?: string | null
          posted_at?: string
          posted_by?: string
          record_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_posting_events_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_posting_events_record_id_version_fkey"
            columns: ["record_id", "version"]
            isOneToOne: true
            referencedRelation: "mcp_cost_approvals"
            referencedColumns: ["record_id", "version"]
          },
        ]
      }
      mcp_cost_receipt_uploads: {
        Row: {
          attempts: number
          company_id: string
          created_at: string
          created_by: string
          expires_at: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          record_id: string
          status: string
          storage_path: string
          token_hash: string
        }
        Insert: {
          attempts?: number
          company_id: string
          created_at?: string
          created_by: string
          expires_at: string
          filename: string
          id?: string
          job_id: string
          mime_type: string
          record_id: string
          status?: string
          storage_path: string
          token_hash: string
        }
        Update: {
          attempts?: number
          company_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          filename?: string
          id?: string
          job_id?: string
          mime_type?: string
          record_id?: string
          status?: string
          storage_path?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_receipt_uploads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_receipt_uploads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_receipt_uploads_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_receipts: {
        Row: {
          company_id: string
          created_by: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          record_id: string
          recorded_at: string
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          company_id: string
          created_by: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          record_id: string
          recorded_at?: string
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          company_id?: string
          created_by?: string
          filename?: string
          id?: string
          job_id?: string
          mime_type?: string
          record_id?: string
          recorded_at?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_receipts_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "mcp_cost_receipt_uploads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_receipts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_receipts_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_review_tickets: {
        Row: {
          actor_id: string
          company_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          job_id: string
          payload: Json
          purpose: string
        }
        Insert: {
          actor_id: string
          company_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          job_id: string
          payload: Json
          purpose: string
        }
        Update: {
          actor_id?: string
          company_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string
          payload?: Json
          purpose?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_review_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_review_tickets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_shared_allocations: {
        Row: {
          amount_cents: number
          payment_id: string
          record_id: string
        }
        Insert: {
          amount_cents: number
          payment_id: string
          record_id: string
        }
        Update: {
          amount_cents?: number
          payment_id?: string
          record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_shared_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_shared_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_shared_allocations_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_shared_payments: {
        Row: {
          amount_cents: number
          company_id: string
          id: string
          paid_on: string
          recorded_at: string
          recorded_by: string
          reference: string
        }
        Insert: {
          amount_cents: number
          company_id: string
          id: string
          paid_on: string
          recorded_at?: string
          recorded_by: string
          reference: string
        }
        Update: {
          amount_cents?: number
          company_id?: string
          id?: string
          paid_on?: string
          recorded_at?: string
          recorded_by?: string
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_shared_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_submission_operations: {
        Row: {
          actor_id: string
          company_id: string
          request_id: string
          result: Json
          signature: string
        }
        Insert: {
          actor_id: string
          company_id: string
          request_id: string
          result: Json
          signature: string
        }
        Update: {
          actor_id?: string
          company_id?: string
          request_id?: string
          result?: Json
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_submission_operations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_submission_references: {
        Row: {
          company_id: string
          counterparty_key: string
          document_key: string
          kind: string
          record_id: string
        }
        Insert: {
          company_id: string
          counterparty_key: string
          document_key: string
          kind: string
          record_id: string
        }
        Update: {
          company_id?: string
          counterparty_key?: string
          document_key?: string
          kind?: string
          record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_submission_references_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_submission_references_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_cost_submission_versions: {
        Row: {
          facts: Json
          project_party_ref: string | null
          purchase_order_ref: string | null
          purchase_order_version_ref: number | null
          reason: string | null
          record_id: string
          recorded_at: string
          recorded_by: string
          version: number
        }
        Insert: {
          facts: Json
          project_party_ref?: string | null
          purchase_order_ref?: string | null
          purchase_order_version_ref?: number | null
          reason?: string | null
          record_id: string
          recorded_at?: string
          recorded_by: string
          version: number
        }
        Update: {
          facts?: Json
          project_party_ref?: string | null
          purchase_order_ref?: string | null
          purchase_order_version_ref?: number | null
          reason?: string | null
          record_id?: string
          recorded_at?: string
          recorded_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_submission_versions_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "mcp_cost_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_version_party_ref"
            columns: ["project_party_ref"]
            isOneToOne: false
            referencedRelation: "mcp_project_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_version_po_ref"
            columns: ["purchase_order_ref"]
            isOneToOne: false
            referencedRelation: "mcp_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_version_po_revision_ref"
            columns: ["purchase_order_ref", "purchase_order_version_ref"]
            isOneToOne: false
            referencedRelation: "mcp_purchase_order_versions"
            referencedColumns: ["po_id", "version"]
          },
        ]
      }
      mcp_cost_submissions: {
        Row: {
          anchor_job_id: string
          company_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
        }
        Insert: {
          anchor_job_id: string
          company_id: string
          created_at?: string
          created_by: string
          id: string
          kind: string
        }
        Update: {
          anchor_job_id?: string
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_cost_submissions_anchor_job_id_fkey"
            columns: ["anchor_job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_cost_submissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_daily_reminder_shows: {
        Row: {
          company_id: string
          job_id: string
          shown_at: string
          shown_on: string
          user_id: string
        }
        Insert: {
          company_id: string
          job_id: string
          shown_at?: string
          shown_on: string
          user_id: string
        }
        Update: {
          company_id?: string
          job_id?: string
          shown_at?: string
          shown_on?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_daily_reminder_shows_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_daily_reminders: {
        Row: {
          company_id: string
          enabled: boolean
          job_id: string
          last_sent_on: string | null
          send_local: string
          time_zone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          enabled?: boolean
          job_id: string
          last_sent_on?: string | null
          send_local?: string
          time_zone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          enabled?: boolean
          job_id?: string
          last_sent_on?: string | null
          send_local?: string
          time_zone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_daily_reminders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_daily_reports: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          delays: string
          deliveries: string
          id: string
          issues: string
          job_id: string
          manpower: string
          report_date: string
          safety: string
          status: string
          subs_on_site: string
          transcript: string | null
          updated_at: string
          weather: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          delays: string
          deliveries: string
          id?: string
          issues: string
          job_id: string
          manpower: string
          report_date: string
          safety: string
          status?: string
          subs_on_site: string
          transcript?: string | null
          updated_at?: string
          weather: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          delays?: string
          deliveries?: string
          id?: string
          issues?: string
          job_id?: string
          manpower?: string
          report_date?: string
          safety?: string
          status?: string
          subs_on_site?: string
          transcript?: string | null
          updated_at?: string
          weather?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_daily_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_daily_work_lines: {
        Row: {
          activity_id: string
          company_id: string
          crew: number
          daily_id: string
          hours: number
          id: string
          job_id: string
          line_no: number
          pct_complete: number | null
          qty: number
          sov_item: string
          unit: string
          work: string
        }
        Insert: {
          activity_id: string
          company_id: string
          crew: number
          daily_id: string
          hours: number
          id?: string
          job_id: string
          line_no: number
          pct_complete?: number | null
          qty: number
          sov_item: string
          unit: string
          work: string
        }
        Update: {
          activity_id?: string
          company_id?: string
          crew?: number
          daily_id?: string
          hours?: number
          id?: string
          job_id?: string
          line_no?: number
          pct_complete?: number | null
          qty?: number
          sov_item?: string
          unit?: string
          work?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_daily_work_lines_daily_id_fkey"
            columns: ["daily_id"]
            isOneToOne: false
            referencedRelation: "mcp_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_daily_work_lines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_delay_events: {
        Row: {
          activity: string | null
          cause: string | null
          claim_item_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          days: number | null
          description: string
          id: string
          job_id: string
          notice_item_id: string | null
          start_date: string | null
          start_known: boolean
        }
        Insert: {
          activity?: string | null
          cause?: string | null
          claim_item_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          days?: number | null
          description: string
          id?: string
          job_id: string
          notice_item_id?: string | null
          start_date?: string | null
          start_known?: boolean
        }
        Update: {
          activity?: string | null
          cause?: string | null
          claim_item_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          days?: number | null
          description?: string
          id?: string
          job_id?: string
          notice_item_id?: string | null
          start_date?: string | null
          start_known?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "mcp_delay_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_drawing_versions: {
        Row: {
          annotations: Json
          company_id: string
          content_hash: string
          created_at: string
          created_by: string
          filename: string
          id: string
          job_id: string
          kind: string
          page: number | null
          page_count: number | null
          parent_id: string | null
          path: string
          sheet: string | null
          sheets: Json
          source_key: string
          source_url: string | null
          storage_bucket: string
          version: number
        }
        Insert: {
          annotations?: Json
          company_id: string
          content_hash: string
          created_at?: string
          created_by: string
          filename: string
          id?: string
          job_id: string
          kind: string
          page?: number | null
          page_count?: number | null
          parent_id?: string | null
          path: string
          sheet?: string | null
          sheets?: Json
          source_key: string
          source_url?: string | null
          storage_bucket?: string
          version: number
        }
        Update: {
          annotations?: Json
          company_id?: string
          content_hash?: string
          created_at?: string
          created_by?: string
          filename?: string
          id?: string
          job_id?: string
          kind?: string
          page?: number | null
          page_count?: number | null
          parent_id?: string | null
          path?: string
          sheet?: string | null
          sheets?: Json
          source_key?: string
          source_url?: string | null
          storage_bucket?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_drawing_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_drawing_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_drawing_versions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "mcp_drawing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_bids: {
        Row: {
          company_id: string
          job_id: string
          overhead_pct: number | null
          profit_pct: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          job_id: string
          overhead_pct?: number | null
          profit_pct?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          job_id?: string
          overhead_pct?: number | null
          profit_pct?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_bids_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_gap_items: {
        Row: {
          active: boolean
          category: string
          company_id: string
          created_at: string
          detail: string | null
          element: string | null
          holds_bid: boolean
          id: string
          job_id: string
          kind: string
          line_no: number | null
          qty: number | null
          reasoning: string
          ref: string
          severity: string
          sheet: string
          spec_section: string
          title: string
          unit: string | null
        }
        Insert: {
          active?: boolean
          category: string
          company_id: string
          created_at?: string
          detail?: string | null
          element?: string | null
          holds_bid?: boolean
          id?: string
          job_id: string
          kind: string
          line_no?: number | null
          qty?: number | null
          reasoning: string
          ref: string
          severity: string
          sheet: string
          spec_section: string
          title: string
          unit?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          company_id?: string
          created_at?: string
          detail?: string | null
          element?: string | null
          holds_bid?: boolean
          id?: string
          job_id?: string
          kind?: string
          line_no?: number | null
          qty?: number | null
          reasoning?: string
          ref?: string
          severity?: string
          sheet?: string
          spec_section?: string
          title?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_gap_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_general_conditions: {
        Row: {
          company_id: string
          duration_days: number | null
          finish_date: string | null
          job_id: string
          lines: Json
          start_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          duration_days?: number | null
          finish_date?: string | null
          job_id: string
          lines?: Json
          start_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          duration_days?: number | null
          finish_date?: string | null
          job_id?: string
          lines?: Json
          start_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_general_conditions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_pricing: {
        Row: {
          company_id: string
          job_id: string
          labor: Json
          material: Json
          quotes: Json
          rate_sources: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          job_id: string
          labor?: Json
          material?: Json
          quotes?: Json
          rate_sources?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          job_id?: string
          labor?: Json
          material?: Json
          quotes?: Json
          rate_sources?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_pricing_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_profiles: {
        Row: {
          company_id: string
          forms_faces: number
          job_id: string
          profile: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          forms_faces?: number
          job_id: string
          profile: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          forms_faces?: number
          job_id?: string
          profile?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_profiles_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_requirements: {
        Row: {
          active: boolean
          amount: number | null
          citation: string
          company_id: string
          confirmed: boolean
          created_at: string
          description: string | null
          excluded: boolean
          id: string
          job_id: string
          kind: string
          label: string
          placement: string
          ref: string
          source_ref: string
          source_type: string
        }
        Insert: {
          active?: boolean
          amount?: number | null
          citation: string
          company_id: string
          confirmed?: boolean
          created_at?: string
          description?: string | null
          excluded?: boolean
          id?: string
          job_id: string
          kind: string
          label: string
          placement?: string
          ref: string
          source_ref: string
          source_type: string
        }
        Update: {
          active?: boolean
          amount?: number | null
          citation?: string
          company_id?: string
          confirmed?: boolean
          created_at?: string
          description?: string | null
          excluded?: boolean
          id?: string
          job_id?: string
          kind?: string
          label?: string
          placement?: string
          ref?: string
          source_ref?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_requirements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_setup: {
        Row: {
          assumptions: Json
          bid_due: string | null
          company_id: string
          delivery_method: string | null
          doc_review: Json | null
          documents: Json
          in_scope: Json
          job_id: string
          out_scope: Json
          role: string | null
          sub_bids: Json
          summary: Json | null
          summary_version: number | null
          trades: Json
          updated_at: string
          updated_by: string | null
          workbook_note: string | null
        }
        Insert: {
          assumptions?: Json
          bid_due?: string | null
          company_id: string
          delivery_method?: string | null
          doc_review?: Json | null
          documents?: Json
          in_scope?: Json
          job_id: string
          out_scope?: Json
          role?: string | null
          sub_bids?: Json
          summary?: Json | null
          summary_version?: number | null
          trades?: Json
          updated_at?: string
          updated_by?: string | null
          workbook_note?: string | null
        }
        Update: {
          assumptions?: Json
          bid_due?: string | null
          company_id?: string
          delivery_method?: string | null
          doc_review?: Json | null
          documents?: Json
          in_scope?: Json
          job_id?: string
          out_scope?: Json
          role?: string | null
          sub_bids?: Json
          summary?: Json | null
          summary_version?: number | null
          trades?: Json
          updated_at?: string
          updated_by?: string | null
          workbook_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_setup_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_takeoff_lines: {
        Row: {
          basis: string
          checklist_key: string | null
          confidence: string
          detail: string | null
          element: string | null
          exclusion: string | null
          id: string
          inputs: Json
          item: string
          job_id: string
          line_no: number
          location_text: string | null
          markup_ref: string | null
          material: string | null
          math: string
          measure_type: string | null
          missing_input: string | null
          note: string | null
          qty: number | null
          range_text: string | null
          sheet: string
          spec_section: string | null
          takeoff_id: string
          trade: string | null
          unit: string | null
        }
        Insert: {
          basis: string
          checklist_key?: string | null
          confidence: string
          detail?: string | null
          element?: string | null
          exclusion?: string | null
          id?: string
          inputs?: Json
          item: string
          job_id: string
          line_no: number
          location_text?: string | null
          markup_ref?: string | null
          material?: string | null
          math: string
          measure_type?: string | null
          missing_input?: string | null
          note?: string | null
          qty?: number | null
          range_text?: string | null
          sheet: string
          spec_section?: string | null
          takeoff_id: string
          trade?: string | null
          unit?: string | null
        }
        Update: {
          basis?: string
          checklist_key?: string | null
          confidence?: string
          detail?: string | null
          element?: string | null
          exclusion?: string | null
          id?: string
          inputs?: Json
          item?: string
          job_id?: string
          line_no?: number
          location_text?: string | null
          markup_ref?: string | null
          material?: string | null
          math?: string
          measure_type?: string | null
          missing_input?: string | null
          note?: string | null
          qty?: number | null
          range_text?: string | null
          sheet?: string
          spec_section?: string | null
          takeoff_id?: string
          trade?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_takeoff_lines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_estimate_takeoff_lines_takeoff_id_fkey"
            columns: ["takeoff_id"]
            isOneToOne: false
            referencedRelation: "mcp_estimate_takeoffs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_takeoffs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          id: string
          job_id: string
          revision: string | null
          scales: Json
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string
          id?: string
          job_id: string
          revision?: string | null
          scales?: Json
          version: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string
          revision?: string | null
          scales?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_takeoffs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_estimate_verdicts: {
        Row: {
          company_id: string
          corrected_qty: number | null
          created_at: string
          gap_ref: string | null
          id: string
          item_kind: string
          item_text: string
          job_id: string
          line_no: number | null
          mark: string
          marked_by: string
          note: string | null
          owner: string | null
        }
        Insert: {
          company_id: string
          corrected_qty?: number | null
          created_at?: string
          gap_ref?: string | null
          id?: string
          item_kind: string
          item_text: string
          job_id: string
          line_no?: number | null
          mark: string
          marked_by?: string
          note?: string | null
          owner?: string | null
        }
        Update: {
          company_id?: string
          corrected_qty?: number | null
          created_at?: string
          gap_ref?: string | null
          id?: string
          item_kind?: string
          item_text?: string
          job_id?: string
          line_no?: number | null
          mark?: string
          marked_by?: string
          note?: string | null
          owner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_estimate_verdicts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_field_activities: {
        Row: {
          activity_id: string
          company_id: string
          crew_size: number | null
          job_id: string
          self_perform: boolean
          sub_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity_id: string
          company_id: string
          crew_size?: number | null
          job_id: string
          self_perform: boolean
          sub_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity_id?: string
          company_id?: string
          crew_size?: number | null
          job_id?: string
          self_perform?: boolean
          sub_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_field_activities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_field_schedule_feed: {
        Row: {
          activity_id: string
          company_id: string
          daily_id: string
          job_id: string
          pct_complete: number
          report_date: string
          updated_at: string
        }
        Insert: {
          activity_id: string
          company_id: string
          daily_id: string
          job_id: string
          pct_complete: number
          report_date: string
          updated_at?: string
        }
        Update: {
          activity_id?: string
          company_id?: string
          daily_id?: string
          job_id?: string
          pct_complete?: number
          report_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_field_schedule_feed_daily_id_fkey"
            columns: ["daily_id"]
            isOneToOne: false
            referencedRelation: "mcp_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_field_schedule_feed_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_file_shares: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          download_count: number
          expires_at: string
          filename: string
          id: string
          job_id: string
          kind: string
          last_downloaded_at: string | null
          mime_type: string
          revoked_at: string | null
          revoked_by: string | null
          sha256: string
          signed_url: string
          size_bytes: number
          storage_path: string
          token_hash: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string
          download_count?: number
          expires_at: string
          filename: string
          id: string
          job_id: string
          kind: string
          last_downloaded_at?: string | null
          mime_type: string
          revoked_at?: string | null
          revoked_by?: string | null
          sha256: string
          signed_url: string
          size_bytes: number
          storage_path: string
          token_hash: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          download_count?: number
          expires_at?: string
          filename?: string
          id?: string
          job_id?: string
          kind?: string
          last_downloaded_at?: string | null
          mime_type?: string
          revoked_at?: string | null
          revoked_by?: string | null
          sha256?: string
          signed_url?: string
          size_bytes?: number
          storage_path?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_file_shares_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_file_uploads: {
        Row: {
          bucket: string
          chunks: number[]
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          filename: string
          id: string
          job_id: string
          mime_type: string
          new_piece: Json | null
          piece_id: string | null
          purpose: string
          result: Json | null
          status: string
          storage_path: string
          submittal_id: string | null
          token_hash: string
        }
        Insert: {
          bucket: string
          chunks?: number[]
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          filename: string
          id?: string
          job_id: string
          mime_type: string
          new_piece?: Json | null
          piece_id?: string | null
          purpose: string
          result?: Json | null
          status?: string
          storage_path: string
          submittal_id?: string | null
          token_hash: string
        }
        Update: {
          bucket?: string
          chunks?: number[]
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          filename?: string
          id?: string
          job_id?: string
          mime_type?: string
          new_piece?: Json | null
          piece_id?: string | null
          purpose?: string
          result?: Json | null
          status?: string
          storage_path?: string
          submittal_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_file_uploads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_gate_cache: {
        Row: {
          active: boolean
          checked_at: string
          user_id: string
        }
        Insert: {
          active: boolean
          checked_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          checked_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_getting_started: {
        Row: {
          seen_at: string
          user_id: string
        }
        Insert: {
          seen_at?: string
          user_id: string
        }
        Update: {
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_guided_sessions: {
        Row: {
          created_at: string
          flow: string
          id: string
          job_id: string
          snapshot: Json
          stage: string
        }
        Insert: {
          created_at?: string
          flow: string
          id?: string
          job_id: string
          snapshot?: Json
          stage: string
        }
        Update: {
          created_at?: string
          flow?: string
          id?: string
          job_id?: string
          snapshot?: Json
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_guided_sessions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_item_events: {
        Row: {
          created_at: string
          event: string
          id: string
          item_id: string
          lookahead_id: string | null
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          item_id: string
          lookahead_id?: string | null
          note?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          item_id?: string
          lookahead_id?: string | null
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "mcp_open_items"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_item_evidence: {
        Row: {
          created_at: string
          evidence: string
          id: string
          item_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          evidence: string
          id?: string
          item_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          evidence?: string
          id?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_item_evidence_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "mcp_open_items"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_job_access: {
        Row: {
          granted_at: string
          granted_by: string
          job_id: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string
          job_id: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_job_access_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_job_answers: {
        Row: {
          answer: string
          answered_at: string
          answered_by: string
          check_key: string
          check_version: number
          detail: string | null
          id: string
          job_id: string
        }
        Insert: {
          answer: string
          answered_at?: string
          answered_by?: string
          check_key: string
          check_version: number
          detail?: string | null
          id?: string
          job_id: string
        }
        Update: {
          answer?: string
          answered_at?: string
          answered_by?: string
          check_key?: string
          check_version?: number
          detail?: string | null
          id?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_job_answers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_job_deadlines: {
        Row: {
          active: boolean
          clause_key: string
          clause_ref: string | null
          company_id: string
          created_at: string
          created_by: string | null
          day_type: string | null
          delivery_method: string | null
          fixed_date: string | null
          holidays: string[] | null
          id: string
          internal_only: boolean
          item_id: string | null
          job_id: string
          label: string
          n_days: number | null
          recipient: string | null
          trigger_alternatives: string[]
          trigger_date: string | null
          trigger_desc: string | null
          weekend_roll: boolean
        }
        Insert: {
          active?: boolean
          clause_key: string
          clause_ref?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          day_type?: string | null
          delivery_method?: string | null
          fixed_date?: string | null
          holidays?: string[] | null
          id?: string
          internal_only?: boolean
          item_id?: string | null
          job_id: string
          label: string
          n_days?: number | null
          recipient?: string | null
          trigger_alternatives?: string[]
          trigger_date?: string | null
          trigger_desc?: string | null
          weekend_roll?: boolean
        }
        Update: {
          active?: boolean
          clause_key?: string
          clause_ref?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          day_type?: string | null
          delivery_method?: string | null
          fixed_date?: string | null
          holidays?: string[] | null
          id?: string
          internal_only?: boolean
          item_id?: string | null
          job_id?: string
          label?: string
          n_days?: number | null
          recipient?: string | null
          trigger_alternatives?: string[]
          trigger_date?: string | null
          trigger_desc?: string | null
          weekend_roll?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "mcp_job_deadlines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_job_facts: {
        Row: {
          id: string
          internal_only: boolean
          job_id: string
          key: string
          module: string
          source: string
          status: string
          updated_at: string
          updated_by: string
          value: Json | null
        }
        Insert: {
          id?: string
          internal_only?: boolean
          job_id: string
          key: string
          module: string
          source: string
          status?: string
          updated_at?: string
          updated_by?: string
          value?: Json | null
        }
        Update: {
          id?: string
          internal_only?: boolean
          job_id?: string
          key?: string
          module?: string
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_job_facts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_job_flags: {
        Row: {
          flag_key: string
          job_id: string
          set_at: string
          set_by: string
          source: string
          value: string
        }
        Insert: {
          flag_key: string
          job_id: string
          set_at?: string
          set_by?: string
          source: string
          value: string
        }
        Update: {
          flag_key?: string
          job_id?: string
          set_at?: string
          set_by?: string
          source?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_job_flags_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_job_na: {
        Row: {
          active: boolean
          id: string
          job_id: string
          reason: string
          reenabled_at: string | null
          reenabled_by: string | null
          scope: string
          set_at: string
          set_by: string
          target: string
        }
        Insert: {
          active?: boolean
          id?: string
          job_id: string
          reason: string
          reenabled_at?: string | null
          reenabled_by?: string | null
          scope: string
          set_at?: string
          set_by?: string
          target: string
        }
        Update: {
          active?: boolean
          id?: string
          job_id?: string
          reason?: string
          reenabled_at?: string | null
          reenabled_by?: string | null
          scope?: string
          set_at?: string
          set_by?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_job_na_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_jobs: {
        Row: {
          company_id: string | null
          contract_completion_date: string | null
          created_at: string
          id: string
          job_number: string | null
          name: string
          pm_email: string | null
          pm_name: string | null
          pm_title: string | null
          pm_user_id: string | null
          restricted: boolean
          sov_basis: string | null
          sov_fee_pct: number | null
          submittal_kickoff_at: string | null
          submittal_posture: string | null
          submittal_review_days: number
          time_zone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          contract_completion_date?: string | null
          created_at?: string
          id?: string
          job_number?: string | null
          name: string
          pm_email?: string | null
          pm_name?: string | null
          pm_title?: string | null
          pm_user_id?: string | null
          restricted?: boolean
          sov_basis?: string | null
          sov_fee_pct?: number | null
          submittal_kickoff_at?: string | null
          submittal_posture?: string | null
          submittal_review_days?: number
          time_zone?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          company_id?: string | null
          contract_completion_date?: string | null
          created_at?: string
          id?: string
          job_number?: string | null
          name?: string
          pm_email?: string | null
          pm_name?: string | null
          pm_title?: string | null
          pm_user_id?: string | null
          restricted?: boolean
          sov_basis?: string | null
          sov_fee_pct?: number | null
          submittal_kickoff_at?: string | null
          submittal_posture?: string | null
          submittal_review_days?: number
          time_zone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_living_reports: {
        Row: {
          activity_count: number | null
          change_what: string
          change_why: string | null
          contract_total: number | null
          created_at: string
          data: Json
          data_date: string | null
          forecast_total: number | null
          id: string
          job_id: string
          report_type: string
          status: string
          updated_by: string
          updated_by_name: string | null
          version: number
        }
        Insert: {
          activity_count?: number | null
          change_what: string
          change_why?: string | null
          contract_total?: number | null
          created_at?: string
          data?: Json
          data_date?: string | null
          forecast_total?: number | null
          id?: string
          job_id: string
          report_type: string
          status?: string
          updated_by?: string
          updated_by_name?: string | null
          version: number
        }
        Update: {
          activity_count?: number | null
          change_what?: string
          change_why?: string | null
          contract_total?: number | null
          created_at?: string
          data?: Json
          data_date?: string | null
          forecast_total?: number | null
          id?: string
          job_id?: string
          report_type?: string
          status?: string
          updated_by?: string
          updated_by_name?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_living_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_lookahead_revisions: {
        Row: {
          created_at: string
          effective_inputs: Json
          end_date: string | null
          id: string
          inputs: Json
          lookahead_id: string
          missing_inputs: string[]
          parent_revision_id: string | null
          provided_inputs: string[]
          rev: number
          schedule_tool: string | null
          source: string
          start_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          effective_inputs?: Json
          end_date?: string | null
          id?: string
          inputs?: Json
          lookahead_id: string
          missing_inputs?: string[]
          parent_revision_id?: string | null
          provided_inputs?: string[]
          rev: number
          schedule_tool?: string | null
          source?: string
          start_date?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          effective_inputs?: Json
          end_date?: string | null
          id?: string
          inputs?: Json
          lookahead_id?: string
          missing_inputs?: string[]
          parent_revision_id?: string | null
          provided_inputs?: string[]
          rev?: number
          schedule_tool?: string | null
          source?: string
          start_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_lookahead_revisions_lookahead_id_fkey"
            columns: ["lookahead_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookaheads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_lookahead_revisions_parent_revision_id_fkey"
            columns: ["parent_revision_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookahead_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_lookaheads: {
        Row: {
          created_at: string
          current_rev: number
          end_date: string | null
          id: string
          inputs: Json
          job_id: string
          missing_inputs: string[]
          provided_inputs: string[]
          start_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          current_rev?: number
          end_date?: string | null
          id?: string
          inputs?: Json
          job_id: string
          missing_inputs?: string[]
          provided_inputs?: string[]
          start_date?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          current_rev?: number
          end_date?: string | null
          id?: string
          inputs?: Json
          job_id?: string
          missing_inputs?: string[]
          provided_inputs?: string[]
          start_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_lookaheads_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_morning_brief_sends: {
        Row: {
          body: string
          created_at: string
          sent_on: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          sent_on: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          sent_on?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_morning_brief_settings: {
        Row: {
          enabled: boolean
          send_local: string
          time_zone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          send_local?: string
          time_zone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          send_local?: string
          time_zone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_morning_brief_shows: {
        Row: {
          shown_at: string
          shown_on: string
          user_id: string
        }
        Insert: {
          shown_at?: string
          shown_on: string
          user_id: string
        }
        Update: {
          shown_at?: string
          shown_on?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_open_items: {
        Row: {
          accountable: string | null
          action: string
          carry_count: number
          cash_effect: string | null
          category: string
          check_key: string
          check_version: number
          clause_source: string | null
          commercial_type: string | null
          company_id: string | null
          cost_effect: string | null
          created_at: string
          delivery_method: string | null
          detail: string | null
          due_date: string | null
          effect_is_estimate: boolean
          help_offer: string | null
          id: string
          internal_only: boolean
          item_type: string | null
          job_id: string
          job_number: string | null
          kind: string
          lookahead_id: string
          lookahead_rev: number | null
          needed_by: string | null
          next_action: string | null
          next_action_approved_by: string | null
          origin_lookahead_id: string
          owner: string
          parent_item_id: string | null
          recipient: string | null
          recommendation: string | null
          reported_at: string | null
          reported_by: string | null
          resolution: string | null
          resolved_at: string | null
          section: string | null
          severity: string
          source: string | null
          status: string
          time_effect: string | null
          trade: string
          updated_at: string
          user_id: string
          verified_at: string | null
          verified_evidence: string | null
          verify_state: string
          waiting_on_document: string | null
          waiting_on_who: string | null
          waiting_since: string | null
          why: string | null
        }
        Insert: {
          accountable?: string | null
          action: string
          carry_count?: number
          cash_effect?: string | null
          category: string
          check_key: string
          check_version: number
          clause_source?: string | null
          commercial_type?: string | null
          company_id?: string | null
          cost_effect?: string | null
          created_at?: string
          delivery_method?: string | null
          detail?: string | null
          due_date?: string | null
          effect_is_estimate?: boolean
          help_offer?: string | null
          id?: string
          internal_only?: boolean
          item_type?: string | null
          job_id: string
          job_number?: string | null
          kind?: string
          lookahead_id: string
          lookahead_rev?: number | null
          needed_by?: string | null
          next_action?: string | null
          next_action_approved_by?: string | null
          origin_lookahead_id: string
          owner?: string
          parent_item_id?: string | null
          recipient?: string | null
          recommendation?: string | null
          reported_at?: string | null
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          section?: string | null
          severity: string
          source?: string | null
          status?: string
          time_effect?: string | null
          trade: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          verified_evidence?: string | null
          verify_state?: string
          waiting_on_document?: string | null
          waiting_on_who?: string | null
          waiting_since?: string | null
          why?: string | null
        }
        Update: {
          accountable?: string | null
          action?: string
          carry_count?: number
          cash_effect?: string | null
          category?: string
          check_key?: string
          check_version?: number
          clause_source?: string | null
          commercial_type?: string | null
          company_id?: string | null
          cost_effect?: string | null
          created_at?: string
          delivery_method?: string | null
          detail?: string | null
          due_date?: string | null
          effect_is_estimate?: boolean
          help_offer?: string | null
          id?: string
          internal_only?: boolean
          item_type?: string | null
          job_id?: string
          job_number?: string | null
          kind?: string
          lookahead_id?: string
          lookahead_rev?: number | null
          needed_by?: string | null
          next_action?: string | null
          next_action_approved_by?: string | null
          origin_lookahead_id?: string
          owner?: string
          parent_item_id?: string | null
          recipient?: string | null
          recommendation?: string | null
          reported_at?: string | null
          reported_by?: string | null
          resolution?: string | null
          resolved_at?: string | null
          section?: string | null
          severity?: string
          source?: string | null
          status?: string
          time_effect?: string | null
          trade?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
          verified_evidence?: string | null
          verify_state?: string
          waiting_on_document?: string | null
          waiting_on_who?: string | null
          waiting_since?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_open_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_open_items_lookahead_id_fkey"
            columns: ["lookahead_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookaheads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_open_items_origin_lookahead_id_fkey"
            columns: ["origin_lookahead_id"]
            isOneToOne: false
            referencedRelation: "mcp_lookaheads"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_po_company_defaults: {
        Row: {
          company_id: string
          terms_id: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          company_id: string
          terms_id: string
          updated_at?: string
          updated_by: string
          version: number
        }
        Update: {
          company_id?: string
          terms_id?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_po_company_defaults_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_company_defaults_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "mcp_po_terms_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_po_default_events: {
        Row: {
          actor_id: string
          company_id: string
          recorded_at: string
          terms_id: string
          version: number
        }
        Insert: {
          actor_id: string
          company_id: string
          recorded_at?: string
          terms_id: string
          version: number
        }
        Update: {
          actor_id?: string
          company_id?: string
          recorded_at?: string
          terms_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_po_default_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_default_events_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "mcp_po_terms_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_po_operations: {
        Row: {
          action: string
          actor_id: string
          job_id: string
          payload_hash: string
          request_id: string
          result: Json
          review_id: string
        }
        Insert: {
          action: string
          actor_id: string
          job_id: string
          payload_hash: string
          request_id: string
          result: Json
          review_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          job_id?: string
          payload_hash?: string
          request_id?: string
          result?: Json
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_po_operations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_po_reviews: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          expires_at: string
          id: string
          job_id: string
          payload_hash: string
          request_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          expires_at?: string
          id: string
          job_id: string
          payload_hash: string
          request_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string
          payload_hash?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_po_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_po_terms_versions: {
        Row: {
          approved_by: string | null
          body: string
          change_note: string | null
          company_id: string
          created_at: string
          created_by: string
          id: string
          job_id: string | null
          parent_id: string | null
          party_id: string | null
          po_id: string | null
          proposal_id: string | null
          scope: string
          source: string
          state: string
          title: string
        }
        Insert: {
          approved_by?: string | null
          body: string
          change_note?: string | null
          company_id: string
          created_at?: string
          created_by: string
          id: string
          job_id?: string | null
          parent_id?: string | null
          party_id?: string | null
          po_id?: string | null
          proposal_id?: string | null
          scope: string
          source: string
          state: string
          title: string
        }
        Update: {
          approved_by?: string | null
          body?: string
          change_note?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string | null
          parent_id?: string | null
          party_id?: string | null
          po_id?: string | null
          proposal_id?: string | null
          scope?: string
          source?: string
          state?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_po_terms_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_terms_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_terms_versions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "mcp_po_terms_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_terms_versions_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "mcp_project_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_terms_versions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "mcp_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_po_terms_versions_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "mcp_po_terms_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_production_rates: {
        Row: {
          activity_id: string
          company_id: string
          created_at: string
          crew: number
          daily_id: string
          hours: number
          id: string
          job_id: string
          man_hours: number
          qty: number
          qty_per_man_hour: number
          sov_item: string
          unit: string
          work: string
        }
        Insert: {
          activity_id: string
          company_id: string
          created_at?: string
          crew: number
          daily_id: string
          hours: number
          id?: string
          job_id: string
          man_hours: number
          qty: number
          qty_per_man_hour: number
          sov_item: string
          unit: string
          work: string
        }
        Update: {
          activity_id?: string
          company_id?: string
          created_at?: string
          crew?: number
          daily_id?: string
          hours?: number
          id?: string
          job_id?: string
          man_hours?: number
          qty?: number
          qty_per_man_hour?: number
          sov_item?: string
          unit?: string
          work?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_production_rates_daily_id_fkey"
            columns: ["daily_id"]
            isOneToOne: false
            referencedRelation: "mcp_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_production_rates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_profiles: {
        Row: {
          company_name: string
          created_at: string
          notes: string | null
          roles: Json
          trades: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          notes?: string | null
          roles?: Json
          trades?: string[]
          updated_at?: string
          user_id?: string
        }
        Update: {
          company_name?: string
          created_at?: string
          notes?: string | null
          roles?: Json
          trades?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_progress_photos: {
        Row: {
          activity_id: string | null
          area: string
          client_safe: boolean
          company_id: string
          created_at: string
          created_by: string | null
          daily_id: string | null
          id: string
          job_id: string
          mime_type: string
          size_bytes: number
          sov_item: string | null
          storage_path: string
          taken_on: string
          work: string | null
        }
        Insert: {
          activity_id?: string | null
          area: string
          client_safe?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          daily_id?: string | null
          id: string
          job_id: string
          mime_type: string
          size_bytes: number
          sov_item?: string | null
          storage_path: string
          taken_on: string
          work?: string | null
        }
        Update: {
          activity_id?: string | null
          area?: string
          client_safe?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          daily_id?: string | null
          id?: string
          job_id?: string
          mime_type?: string
          size_bytes?: number
          sov_item?: string | null
          storage_path?: string
          taken_on?: string
          work?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_progress_photos_daily_id_fkey"
            columns: ["daily_id"]
            isOneToOne: false
            referencedRelation: "mcp_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_progress_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_project_parties: {
        Row: {
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_reference: string | null
          created_at: string
          created_by: string
          id: string
          insurance_reference: string | null
          job_id: string
          kind: string
          name: string
          trade: string | null
          version: number
        }
        Insert: {
          company_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by: string
          id: string
          insurance_reference?: string | null
          job_id: string
          kind: string
          name: string
          trade?: string | null
          version?: number
        }
        Update: {
          company_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string
          id?: string
          insurance_reference?: string | null
          job_id?: string
          kind?: string
          name?: string
          trade?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_project_parties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_project_parties_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_project_party_versions: {
        Row: {
          party_id: string
          reason: string | null
          recorded_at: string
          recorded_by: string
          snapshot: Json
          version: number
        }
        Insert: {
          party_id: string
          reason?: string | null
          recorded_at?: string
          recorded_by: string
          snapshot: Json
          version: number
        }
        Update: {
          party_id?: string
          reason?: string | null
          recorded_at?: string
          recorded_by?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_project_party_versions_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "mcp_project_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_project_record_events: {
        Row: {
          actor: string
          actor_id: string | null
          company_id: string
          counterparty_email: string | null
          counterparty_name: string | null
          host: string | null
          id: string
          job_id: string
          kind: string
          occurred_at: string
          payload: Json
          ref_id: string | null
          ref_table: string | null
          summary: string
          thread_ref: string | null
          title: string
        }
        Insert: {
          actor: string
          actor_id?: string | null
          company_id: string
          counterparty_email?: string | null
          counterparty_name?: string | null
          host?: string | null
          id?: string
          job_id: string
          kind: string
          occurred_at?: string
          payload?: Json
          ref_id?: string | null
          ref_table?: string | null
          summary: string
          thread_ref?: string | null
          title: string
        }
        Update: {
          actor?: string
          actor_id?: string | null
          company_id?: string
          counterparty_email?: string | null
          counterparty_name?: string | null
          host?: string | null
          id?: string
          job_id?: string
          kind?: string
          occurred_at?: string
          payload?: Json
          ref_id?: string | null
          ref_table?: string | null
          summary?: string
          thread_ref?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_project_record_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_purchase_order_versions: {
        Row: {
          created_at: string
          created_by: string
          lines: Json
          needed_by: string
          order_date: string
          party_snapshot: Json
          po_id: string
          reason: string | null
          status: string
          terms_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          lines: Json
          needed_by: string
          order_date: string
          party_snapshot: Json
          po_id: string
          reason?: string | null
          status: string
          terms_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          lines?: Json
          needed_by?: string
          order_date?: string
          party_snapshot?: Json
          po_id?: string
          reason?: string | null
          status?: string
          terms_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_purchase_order_versions_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "mcp_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_purchase_order_versions_terms_id_fkey"
            columns: ["terms_id"]
            isOneToOne: false
            referencedRelation: "mcp_po_terms_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_purchase_orders: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          id: string
          job_id: string
          number: string
          party_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          id: string
          job_id: string
          number: string
          party_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          job_id?: string
          number?: string
          party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_purchase_orders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_purchase_orders_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "mcp_project_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_push_send_log: {
        Row: {
          created_at: string
          error_text: string | null
          http_code: number | null
          id: string
          job_id: string | null
          payload_kind: string
          status: string
          subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_text?: string | null
          http_code?: number | null
          id?: string
          job_id?: string | null
          payload_kind: string
          status: string
          subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_text?: string | null
          http_code?: number | null
          id?: string
          job_id?: string | null
          payload_kind?: string
          status?: string
          subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_push_send_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_push_send_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "mcp_push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_push_subscriptions: {
        Row: {
          auth_secret: string
          company_id: string
          created_at: string
          dead_at: string | null
          endpoint: string
          id: string
          job_id: string
          last_sent_on: string | null
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_secret: string
          company_id: string
          created_at?: string
          dead_at?: string | null
          endpoint: string
          id?: string
          job_id: string
          last_sent_on?: string | null
          p256dh: string
          user_id: string
        }
        Update: {
          auth_secret?: string
          company_id?: string
          created_at?: string
          dead_at?: string | null
          endpoint?: string
          id?: string
          job_id?: string
          last_sent_on?: string | null
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_push_subscriptions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_reenable_prompts: {
        Row: {
          actor: string
          created_at: string
          decided_at: string | null
          id: string
          na_id: string
          outcome: string
          trigger_key: string
        }
        Insert: {
          actor?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          na_id: string
          outcome?: string
          trigger_key: string
        }
        Update: {
          actor?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          na_id?: string
          outcome?: string
          trigger_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_reenable_prompts_na_id_fkey"
            columns: ["na_id"]
            isOneToOne: false
            referencedRelation: "mcp_job_na"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_report_shares: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          job_id: string | null
          last_viewed_at: string | null
          page: string
          revoked_at: string | null
          revoked_by: string | null
          show_money: boolean
          token_hash: string
          view_count: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string
          expires_at: string
          id?: string
          job_id?: string | null
          last_viewed_at?: string | null
          page: string
          revoked_at?: string | null
          revoked_by?: string | null
          show_money?: boolean
          token_hash: string
          view_count?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          job_id?: string | null
          last_viewed_at?: string | null
          page?: string
          revoked_at?: string | null
          revoked_by?: string | null
          show_money?: boolean
          token_hash?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_report_shares_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_request_operations: {
        Row: {
          actor_id: string
          created_at: string
          digest: string
          job_id: string
          request_id: string
          submittal_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          digest: string
          job_id: string
          request_id: string
          submittal_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          digest?: string
          job_id?: string
          request_id?: string
          submittal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_request_operations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_request_operations_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_security_flags: {
        Row: {
          company_id: string | null
          created_at: string
          detail: Json
          id: number
          kind: string
          tool: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          detail?: Json
          id?: number
          kind: string
          tool: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          detail?: Json
          id?: number
          kind?: string
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_security_flags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_sessions: {
        Row: {
          last_call_at: string
          session_started_at: string
          user_id: string
        }
        Insert: {
          last_call_at?: string
          session_started_at?: string
          user_id: string
        }
        Update: {
          last_call_at?: string
          session_started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_spec_documents: {
        Row: {
          body: string
          body_sha256: string
          company_id: string
          created_by: string | null
          file_sha256: string | null
          id: string
          job_id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          upload_id: string | null
        }
        Insert: {
          body: string
          body_sha256: string
          company_id: string
          created_by?: string | null
          file_sha256?: string | null
          id?: string
          job_id: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_bucket: string
          storage_path: string
          updated_at?: string
          upload_id?: string | null
        }
        Update: {
          body?: string
          body_sha256?: string
          company_id?: string
          created_by?: string | null
          file_sha256?: string | null
          id?: string
          job_id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_spec_documents_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_submittal_mail: {
        Row: {
          approved_at: string | null
          company_id: string
          context_key: string
          created_at: string
          draft: Json
          draft_key: string
          id: string
          job_id: string
          kind: string
          message_id: string | null
          package_id: string | null
          package_item_id: string | null
          provider: string | null
          sent_at: string | null
          submittal_id: string
        }
        Insert: {
          approved_at?: string | null
          company_id: string
          context_key: string
          created_at?: string
          draft: Json
          draft_key: string
          id?: string
          job_id: string
          kind: string
          message_id?: string | null
          package_id?: string | null
          package_item_id?: string | null
          provider?: string | null
          sent_at?: string | null
          submittal_id: string
        }
        Update: {
          approved_at?: string | null
          company_id?: string
          context_key?: string
          created_at?: string
          draft?: Json
          draft_key?: string
          id?: string
          job_id?: string
          kind?: string
          message_id?: string | null
          package_id?: string | null
          package_item_id?: string | null
          provider?: string | null
          sent_at?: string | null
          submittal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_submittal_mail_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittal_mail_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittal_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittal_mail_package_item_id_fkey"
            columns: ["package_item_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittal_package_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittal_mail_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_submittal_package_items: {
        Row: {
          chase_count: number
          chase_email: string | null
          chase_name: string | null
          chase_role: string | null
          company_id: string
          created_at: string
          file_ref: string | null
          id: string
          job_id: string
          kind: string
          last_chased_at: string | null
          next_chase_at: string | null
          received_at: string | null
          requested_at: string | null
          required: boolean
          source_party: string
          status: string
          submittal_id: string
          updated_at: string
        }
        Insert: {
          chase_count?: number
          chase_email?: string | null
          chase_name?: string | null
          chase_role?: string | null
          company_id: string
          created_at?: string
          file_ref?: string | null
          id?: string
          job_id: string
          kind: string
          last_chased_at?: string | null
          next_chase_at?: string | null
          received_at?: string | null
          requested_at?: string | null
          required?: boolean
          source_party: string
          status: string
          submittal_id: string
          updated_at?: string
        }
        Update: {
          chase_count?: number
          chase_email?: string | null
          chase_name?: string | null
          chase_role?: string | null
          company_id?: string
          created_at?: string
          file_ref?: string | null
          id?: string
          job_id?: string
          kind?: string
          last_chased_at?: string | null
          next_chase_at?: string | null
          received_at?: string | null
          requested_at?: string | null
          required?: boolean
          source_party?: string
          status?: string
          submittal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_submittal_package_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittal_package_items_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_submittal_packages: {
        Row: {
          approved_at: string | null
          company_id: string
          cover_date: string
          created_at: string
          download_url: string
          expires_at: string
          filename: string
          fingerprint: string
          id: string
          job_id: string
          manifest: Json
          page_count: number
          path: string
          preview_expires_at: string | null
          preview_hash: string | null
          preview_signed_url: string | null
          revoked_at: string | null
          sent_at: string | null
          sha256: string
          signed_url: string
          size_bytes: number
          submittal_id: string
          token_hash: string
          transmittal_id: string | null
        }
        Insert: {
          approved_at?: string | null
          company_id: string
          cover_date: string
          created_at?: string
          download_url: string
          expires_at: string
          filename: string
          fingerprint: string
          id: string
          job_id: string
          manifest: Json
          page_count: number
          path: string
          preview_expires_at?: string | null
          preview_hash?: string | null
          preview_signed_url?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          sha256: string
          signed_url: string
          size_bytes: number
          submittal_id: string
          token_hash: string
          transmittal_id?: string | null
        }
        Update: {
          approved_at?: string | null
          company_id?: string
          cover_date?: string
          created_at?: string
          download_url?: string
          expires_at?: string
          filename?: string
          fingerprint?: string
          id?: string
          job_id?: string
          manifest?: Json
          page_count?: number
          path?: string
          preview_expires_at?: string | null
          preview_hash?: string | null
          preview_signed_url?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          sha256?: string
          signed_url?: string
          size_bytes?: number
          submittal_id?: string
          token_hash?: string
          transmittal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_submittal_packages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittal_packages_submittal_id_fkey"
            columns: ["submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittal_packages_transmittal_id_fkey"
            columns: ["transmittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_transmittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_submittals: {
        Row: {
          ball_in_court: string
          ball_in_court_name: string | null
          chase_count: number
          chase_email: string | null
          chase_name: string | null
          chase_role: string | null
          company_id: string
          created_at: string
          created_by: string | null
          due_back: string | null
          id: string
          job_id: string
          last_chased_at: string | null
          next_chase_at: string | null
          not_required_reason: string | null
          notes: string | null
          number: string
          package_purpose: string
          previous_id: string | null
          request_details: Json | null
          required: boolean
          required_by: string | null
          returned_on: string | null
          review_days: number
          revision: number
          source: string
          spec_excerpt: string | null
          spec_section: string
          status: string
          submittal_type: string
          submitted_on: string | null
          title: string
          transmittal_id: string
          updated_at: string
        }
        Insert: {
          ball_in_court: string
          ball_in_court_name?: string | null
          chase_count?: number
          chase_email?: string | null
          chase_name?: string | null
          chase_role?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          due_back?: string | null
          id?: string
          job_id: string
          last_chased_at?: string | null
          next_chase_at?: string | null
          not_required_reason?: string | null
          notes?: string | null
          number: string
          package_purpose?: string
          previous_id?: string | null
          request_details?: Json | null
          required?: boolean
          required_by?: string | null
          returned_on?: string | null
          review_days?: number
          revision?: number
          source?: string
          spec_excerpt?: string | null
          spec_section: string
          status: string
          submittal_type: string
          submitted_on?: string | null
          title: string
          transmittal_id: string
          updated_at?: string
        }
        Update: {
          ball_in_court?: string
          ball_in_court_name?: string | null
          chase_count?: number
          chase_email?: string | null
          chase_name?: string | null
          chase_role?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_back?: string | null
          id?: string
          job_id?: string
          last_chased_at?: string | null
          next_chase_at?: string | null
          not_required_reason?: string | null
          notes?: string | null
          number?: string
          package_purpose?: string
          previous_id?: string | null
          request_details?: Json | null
          required?: boolean
          required_by?: string | null
          returned_on?: string | null
          review_days?: number
          revision?: number
          source?: string
          spec_excerpt?: string | null
          spec_section?: string
          status?: string
          submittal_type?: string
          submitted_on?: string | null
          title?: string
          transmittal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_submittals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittals_previous_id_fkey"
            columns: ["previous_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_submittals_transmittal_id_fkey"
            columns: ["transmittal_id"]
            isOneToOne: true
            referencedRelation: "mcp_transmittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_surfaced: {
        Row: {
          first_surfaced_at: string
          id: string
          item_id: string | null
          job_id: string
          last_surfaced_at: string
          ref: string
          times: number
          user_id: string
        }
        Insert: {
          first_surfaced_at?: string
          id?: string
          item_id?: string | null
          job_id: string
          last_surfaced_at?: string
          ref: string
          times?: number
          user_id?: string
        }
        Update: {
          first_surfaced_at?: string
          id?: string
          item_id?: string | null
          job_id?: string
          last_surfaced_at?: string
          ref?: string
          times?: number
          user_id?: string
        }
        Relationships: []
      }
      mcp_takeoff_calibrations: {
        Row: {
          bounds: Json
          company_id: string
          confidence: string
          confirmed: boolean
          created_at: string
          created_by: string
          feet_per_point: number
          height: number
          id: string
          job_id: string
          method: string
          page: number
          reference: Json
          region: string
          source_id: string
          version: number
          width: number
        }
        Insert: {
          bounds: Json
          company_id: string
          confidence: string
          confirmed: boolean
          created_at?: string
          created_by?: string
          feet_per_point: number
          height: number
          id?: string
          job_id: string
          method: string
          page: number
          reference: Json
          region: string
          source_id: string
          version: number
          width: number
        }
        Update: {
          bounds?: Json
          company_id?: string
          confidence?: string
          confirmed?: boolean
          created_at?: string
          created_by?: string
          feet_per_point?: number
          height?: number
          id?: string
          job_id?: string
          method?: string
          page?: number
          reference?: Json
          region?: string
          source_id?: string
          version?: number
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_takeoff_calibrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_takeoff_calibrations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_takeoff_geometry: {
        Row: {
          calibration_id: string | null
          company_id: string
          created_at: string
          created_by: string
          evidence: Json
          geometry_id: string
          id: string
          job_id: string
          line_id: string
          measured: number | null
          page: number | null
          reason: string | null
          shape: Json
          source: string
          source_id: string | null
          status: string
          unit: string | null
          version: number
        }
        Insert: {
          calibration_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string
          evidence?: Json
          geometry_id: string
          id?: string
          job_id: string
          line_id: string
          measured?: number | null
          page?: number | null
          reason?: string | null
          shape: Json
          source: string
          source_id?: string | null
          status: string
          unit?: string | null
          version: number
        }
        Update: {
          calibration_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string
          evidence?: Json
          geometry_id?: string
          id?: string
          job_id?: string
          line_id?: string
          measured?: number | null
          page?: number | null
          reason?: string | null
          shape?: Json
          source?: string
          source_id?: string | null
          status?: string
          unit?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "mcp_takeoff_geometry_calibration_id_fkey"
            columns: ["calibration_id"]
            isOneToOne: false
            referencedRelation: "mcp_takeoff_calibrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_takeoff_geometry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_takeoff_geometry_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_takeoff_geometry_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "mcp_estimate_takeoff_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_takeoff_markups: {
        Row: {
          company_id: string
          content_hash: string | null
          created_at: string
          created_by: string
          geometry_revs: Json
          id: string
          job_id: string
          kind: string
          page: number
          pass_summary: Json
          rendered_pdf: string | null
          rendered_png: string | null
          source_id: string
        }
        Insert: {
          company_id: string
          content_hash?: string | null
          created_at?: string
          created_by?: string
          geometry_revs?: Json
          id?: string
          job_id: string
          kind: string
          page: number
          pass_summary?: Json
          rendered_pdf?: string | null
          rendered_png?: string | null
          source_id: string
        }
        Update: {
          company_id?: string
          content_hash?: string | null
          created_at?: string
          created_by?: string
          geometry_revs?: Json
          id?: string
          job_id?: string
          kind?: string
          page?: number
          pass_summary?: Json
          rendered_pdf?: string | null
          rendered_png?: string | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_takeoff_markups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_takeoff_markups_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_team_audit: {
        Row: {
          action: string
          actor: string
          after: Json | null
          before: Json | null
          company_id: string
          created_at: string
          id: number
          target_email: string | null
          target_user: string | null
        }
        Insert: {
          action: string
          actor: string
          after?: Json | null
          before?: Json | null
          company_id: string
          created_at?: string
          id?: number
          target_email?: string | null
          target_user?: string | null
        }
        Update: {
          action?: string
          actor?: string
          after?: Json | null
          before?: Json | null
          company_id?: string
          created_at?: string
          id?: number
          target_email?: string | null
          target_user?: string | null
        }
        Relationships: []
      }
      mcp_team_invites: {
        Row: {
          accepted_at: string | null
          accepted_user: string | null
          company_id: string
          created_at: string
          display_name: string
          email: string
          id: string
          invited_by: string
          job_ids: string[]
          role: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user?: string | null
          company_id: string
          created_at?: string
          display_name: string
          email: string
          id?: string
          invited_by: string
          job_ids?: string[]
          role: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user?: string | null
          company_id?: string
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          invited_by?: string
          job_ids?: string[]
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_team_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_team_plans: {
        Row: {
          included_seats: number
          note: string | null
          roles: string[] | null
          tier: string
          updated_at: string
        }
        Insert: {
          included_seats?: number
          note?: string | null
          roles?: string[] | null
          tier: string
          updated_at?: string
        }
        Update: {
          included_seats?: number
          note?: string | null
          roles?: string[] | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      mcp_terms_acceptances: {
        Row: {
          accepted_at: string
          authorization_id: string | null
          context: string
          id: number
          terms_url: string
          terms_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          authorization_id?: string | null
          context?: string
          id?: number
          terms_url: string
          terms_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          authorization_id?: string | null
          context?: string
          id?: number
          terms_url?: string
          terms_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mcp_transmittals: {
        Row: {
          company_id: string
          cover_note: string | null
          created_at: string
          created_by: string | null
          id: string
          job_id: string
          number: number
          package_fingerprint: string | null
          package_submittal_id: string | null
          sent_on: string | null
          subject: string | null
          to_email: string | null
          to_name: string | null
        }
        Insert: {
          company_id: string
          cover_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_id: string
          number: number
          package_fingerprint?: string | null
          package_submittal_id?: string | null
          sent_on?: string | null
          subject?: string | null
          to_email?: string | null
          to_name?: string | null
        }
        Update: {
          company_id?: string
          cover_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string
          number?: number
          package_fingerprint?: string | null
          package_submittal_id?: string | null
          sent_on?: string | null
          subject?: string | null
          to_email?: string | null
          to_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mcp_transmittals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "mcp_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_transmittals_package_submittal_id_fkey"
            columns: ["package_submittal_id"]
            isOneToOne: false
            referencedRelation: "mcp_submittals"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_usage: {
        Row: {
          period: string
          updated_at: string
          usage_limit: number
          used: number
          user_id: string
        }
        Insert: {
          period: string
          updated_at?: string
          usage_limit: number
          used?: number
          user_id: string
        }
        Update: {
          period?: string
          updated_at?: string
          usage_limit?: number
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      mcp_user_push_subscriptions: {
        Row: {
          auth_secret: string
          created_at: string
          dead_at: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_secret: string
          created_at?: string
          dead_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_secret?: string
          created_at?: string
          dead_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_user_settings: {
        Row: {
          current_company: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          current_company?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          current_company?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_user_settings_current_company_fkey"
            columns: ["current_company"]
            isOneToOne: false
            referencedRelation: "mcp_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_workflow_log: {
        Row: {
          check_key: string | null
          created_at: string
          error_code: string | null
          event_type: string
          id: string
          lookahead_id: string | null
          tool: string
          user_id: string
        }
        Insert: {
          check_key?: string | null
          created_at?: string
          error_code?: string | null
          event_type: string
          id?: string
          lookahead_id?: string | null
          tool: string
          user_id?: string
        }
        Update: {
          check_key?: string | null
          created_at?: string
          error_code?: string | null
          event_type?: string
          id?: string
          lookahead_id?: string | null
          tool?: string
          user_id?: string
        }
        Relationships: []
      }
      member_announcements: {
        Row: {
          announcement_id: string | null
          announcement_mode: string
          audience: string
          body: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          headline: string
          id: string
          preheader: string | null
          recipient_count: number
          sent_by: string | null
          session_snapshot: Json | null
          signoff: string | null
          subject: string
          was_test: boolean
        }
        Insert: {
          announcement_id?: string | null
          announcement_mode?: string
          audience: string
          body: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          headline: string
          id?: string
          preheader?: string | null
          recipient_count?: number
          sent_by?: string | null
          session_snapshot?: Json | null
          signoff?: string | null
          subject: string
          was_test?: boolean
        }
        Update: {
          announcement_id?: string | null
          announcement_mode?: string
          audience?: string
          body?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          headline?: string
          id?: string
          preheader?: string | null
          recipient_count?: number
          sent_by?: string | null
          session_snapshot?: Json | null
          signoff?: string | null
          subject?: string
          was_test?: boolean
        }
        Relationships: []
      }
      member_control_progress: {
        Row: {
          assessment_started_at: string | null
          baseline_saved_at: string | null
          created_at: string
          latest_baseline_id: string | null
          latest_score: number | null
          orientation_opened_at: string | null
          plan_completed_at: string | null
          plan_started_at: string | null
          plan_updated_at: string | null
          primary_category: string | null
          primary_constraint: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assessment_started_at?: string | null
          baseline_saved_at?: string | null
          created_at?: string
          latest_baseline_id?: string | null
          latest_score?: number | null
          orientation_opened_at?: string | null
          plan_completed_at?: string | null
          plan_started_at?: string | null
          plan_updated_at?: string | null
          primary_category?: string | null
          primary_constraint?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assessment_started_at?: string | null
          baseline_saved_at?: string | null
          created_at?: string
          latest_baseline_id?: string | null
          latest_score?: number | null
          orientation_opened_at?: string | null
          plan_completed_at?: string | null
          plan_started_at?: string | null
          plan_updated_at?: string | null
          primary_category?: string | null
          primary_constraint?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_control_progress_latest_baseline_id_fkey"
            columns: ["latest_baseline_id"]
            isOneToOne: false
            referencedRelation: "vault_packets"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_claims: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          current_period_end: string | null
          email: string
          id: string
          metadata: Json
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          current_period_end?: string | null
          email: string
          id?: string
          metadata?: Json
          price_id?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          current_period_end?: string | null
          email?: string
          id?: string
          metadata?: Json
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      replay_resources: {
        Row: {
          created_at: string
          id: string
          replay_id: string
          sort_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          replay_id: string
          sort_order?: number
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          replay_id?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "replay_resources_replay_id_fkey"
            columns: ["replay_id"]
            isOneToOne: false
            referencedRelation: "replays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "replay_resources_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      replays: {
        Row: {
          category: Database["public"]["Enums"]["replay_category"]
          created_at: string
          description: string | null
          duration_minutes: number | null
          featured: boolean
          id: string
          published: boolean
          recorded_at: string
          share_url: string | null
          tags: string[]
          thumbnail_url: string | null
          title: string
          video_url: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["replay_category"]
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          featured?: boolean
          id?: string
          published?: boolean
          recorded_at?: string
          share_url?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title: string
          video_url?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["replay_category"]
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          featured?: boolean
          id?: string
          published?: boolean
          recorded_at?: string
          share_url?: string | null
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          video_url?: string | null
        }
        Relationships: []
      }
      resend_sync_log: {
        Row: {
          created_at: string
          email: string
          id: string
          reason: string | null
          segment: string | null
          source: string
          status: string
          stripe_subscription_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          reason?: string | null
          segment?: string | null
          source: string
          status: string
          stripe_subscription_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          reason?: string | null
          segment?: string | null
          source?: string
          status?: string
          stripe_subscription_id?: string | null
        }
        Relationships: []
      }
      schedule_baselines: {
        Row: {
          created_at: string
          dependencies: Json
          holidays: Json
          id: string
          name: string
          notes: string | null
          project_start_date: string | null
          schedule_id: string
          tasks: Json
          updated_at: string
          work_days: number
        }
        Insert: {
          created_at?: string
          dependencies?: Json
          holidays?: Json
          id?: string
          name: string
          notes?: string | null
          project_start_date?: string | null
          schedule_id: string
          tasks?: Json
          updated_at?: string
          work_days?: number
        }
        Update: {
          created_at?: string
          dependencies?: Json
          holidays?: Json
          id?: string
          name?: string
          notes?: string | null
          project_start_date?: string | null
          schedule_id?: string
          tasks?: Json
          updated_at?: string
          work_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_baselines_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_calendars: {
        Row: {
          created_at: string
          holidays: Json
          id: string
          is_default: boolean
          name: string
          position: number
          schedule_id: string
          updated_at: string
          work_days: number
        }
        Insert: {
          created_at?: string
          holidays?: Json
          id?: string
          is_default?: boolean
          name: string
          position?: number
          schedule_id: string
          updated_at?: string
          work_days?: number
        }
        Update: {
          created_at?: string
          holidays?: Json
          id?: string
          is_default?: boolean
          name?: string
          position?: number
          schedule_id?: string
          updated_at?: string
          work_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_calendars_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_dependencies: {
        Row: {
          created_at: string
          from_task_id: string
          id: string
          lag: number
          schedule_id: string
          to_task_id: string
          type: Database["public"]["Enums"]["scheduler_dep_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_task_id: string
          id?: string
          lag?: number
          schedule_id: string
          to_task_id: string
          type?: Database["public"]["Enums"]["scheduler_dep_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_task_id?: string
          id?: string
          lag?: number
          schedule_id?: string
          to_task_id?: string
          type?: Database["public"]["Enums"]["scheduler_dep_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_dependencies_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["schedule_member_role"]
          schedule_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["schedule_member_role"]
          schedule_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["schedule_member_role"]
          schedule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_members_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_tasks: {
        Row: {
          actual_cost: number | null
          budget_cost: number | null
          calendar_id: string | null
          constraint_type: string | null
          created_at: string
          description: string | null
          duration: number
          finish_no_later_than: string | null
          id: string
          name: string
          percent_complete: number | null
          position: number
          resource_name: string | null
          resource_units_per_day: number | null
          schedule_id: string
          start_no_earlier_than: string | null
          task_id: string
          updated_at: string
          wbs: string | null
          wbs_node_id: string | null
        }
        Insert: {
          actual_cost?: number | null
          budget_cost?: number | null
          calendar_id?: string | null
          constraint_type?: string | null
          created_at?: string
          description?: string | null
          duration?: number
          finish_no_later_than?: string | null
          id?: string
          name: string
          percent_complete?: number | null
          position?: number
          resource_name?: string | null
          resource_units_per_day?: number | null
          schedule_id: string
          start_no_earlier_than?: string | null
          task_id: string
          updated_at?: string
          wbs?: string | null
          wbs_node_id?: string | null
        }
        Update: {
          actual_cost?: number | null
          budget_cost?: number | null
          calendar_id?: string | null
          constraint_type?: string | null
          created_at?: string
          description?: string | null
          duration?: number
          finish_no_later_than?: string | null
          id?: string
          name?: string
          percent_complete?: number | null
          position?: number
          resource_name?: string | null
          resource_units_per_day?: number | null
          schedule_id?: string
          start_no_earlier_than?: string | null
          task_id?: string
          updated_at?: string
          wbs?: string | null
          wbs_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_tasks_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "schedule_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_wbs_node_id_fkey"
            columns: ["wbs_node_id"]
            isOneToOne: false
            referencedRelation: "wbs_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          annotations: Json
          client: string | null
          cover_color: string | null
          created_at: string
          data_date: string | null
          holidays: Json
          id: string
          name: string
          notes: string | null
          project_number: string | null
          project_start_date: string | null
          status: Database["public"]["Enums"]["schedule_status"]
          tags: string[]
          updated_at: string
          user_id: string
          work_days: number
        }
        Insert: {
          annotations?: Json
          client?: string | null
          cover_color?: string | null
          created_at?: string
          data_date?: string | null
          holidays?: Json
          id?: string
          name: string
          notes?: string | null
          project_number?: string | null
          project_start_date?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          tags?: string[]
          updated_at?: string
          user_id: string
          work_days?: number
        }
        Update: {
          annotations?: Json
          client?: string | null
          cover_color?: string | null
          created_at?: string
          data_date?: string | null
          holidays?: Json
          id?: string
          name?: string
          notes?: string | null
          project_number?: string | null
          project_start_date?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          tags?: string[]
          updated_at?: string
          user_id?: string
          work_days?: number
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          attempts: number
          created_at: string
          event_id: string
          event_type: string
          last_error: string | null
          object_id: string | null
          processed_at: string | null
          processing_started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_id: string
          event_type: string
          last_error?: string | null
          object_id?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_id?: string
          event_type?: string
          last_error?: string | null
          object_id?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          discord_nudge_sent_at: string | null
          email: string
          id: string
          is_comped: boolean
          is_founding: boolean
          login_nudge_sent_at: string | null
          metadata: Json
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: Database["public"]["Enums"]["app_tier"]
          updated_at: string
          user_id: string | null
          welcome_sent_at: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          discord_nudge_sent_at?: string | null
          email: string
          id?: string
          is_comped?: boolean
          is_founding?: boolean
          login_nudge_sent_at?: string | null
          metadata?: Json
          price_id?: string | null
          product_id?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
          updated_at?: string
          user_id?: string | null
          welcome_sent_at?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          discord_nudge_sent_at?: string | null
          email?: string
          id?: string
          is_comped?: boolean
          is_founding?: boolean
          login_nudge_sent_at?: string | null
          metadata?: Json
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
          updated_at?: string
          user_id?: string | null
          welcome_sent_at?: string | null
        }
        Relationships: []
      }
      support_ticket_counters: {
        Row: {
          brand: string
          last_number: number
        }
        Insert: {
          brand: string
          last_number?: number
        }
        Update: {
          brand?: string
          last_number?: number
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          autoreply_sent_at: string | null
          autoreply_suppressed_reason: string | null
          brand: string
          from_email: string
          id: string
          message_id: string | null
          notify_sent_at: string | null
          raw_summary: string | null
          received_at: string
          resend_email_id: string
          status: string
          subject: string | null
          ticket_number: string
        }
        Insert: {
          autoreply_sent_at?: string | null
          autoreply_suppressed_reason?: string | null
          brand: string
          from_email: string
          id?: string
          message_id?: string | null
          notify_sent_at?: string | null
          raw_summary?: string | null
          received_at?: string
          resend_email_id: string
          status?: string
          subject?: string | null
          ticket_number: string
        }
        Update: {
          autoreply_sent_at?: string | null
          autoreply_suppressed_reason?: string | null
          brand?: string
          from_email?: string
          id?: string
          message_id?: string | null
          notify_sent_at?: string | null
          raw_summary?: string | null
          received_at?: string
          resend_email_id?: string
          status?: string
          subject?: string | null
          ticket_number?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      task_activity_codes: {
        Row: {
          created_at: string
          id: string
          schedule_id: string
          task_id: string
          type_id: string
          value_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          schedule_id: string
          task_id: string
          type_id: string
          value_id: string
        }
        Update: {
          created_at?: string
          id?: string
          schedule_id?: string
          task_id?: string
          type_id?: string
          value_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_codes_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_codes_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "activity_code_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_codes_value_id_fkey"
            columns: ["value_id"]
            isOneToOne: false
            referencedRelation: "activity_code_values"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          badge: string | null
          category: string
          created_at: string
          description: string
          download_url: string | null
          featured: boolean
          file_type: string
          highlights: string[]
          id: string
          long_description: string | null
          pages: string | null
          published: boolean
          title: string
        }
        Insert: {
          badge?: string | null
          category: string
          created_at?: string
          description: string
          download_url?: string | null
          featured?: boolean
          file_type?: string
          highlights?: string[]
          id?: string
          long_description?: string | null
          pages?: string | null
          published?: boolean
          title: string
        }
        Update: {
          badge?: string | null
          category?: string
          created_at?: string
          description?: string
          download_url?: string | null
          featured?: boolean
          file_type?: string
          highlights?: string[]
          id?: string
          long_description?: string | null
          pages?: string | null
          published?: boolean
          title?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_packets: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          source: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload: Json
          source: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          source?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      wbs_nodes: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
          position: number
          schedule_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          position?: number
          schedule_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          position?: number
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wbs_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "wbs_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wbs_nodes_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_moves: {
        Row: {
          active_from: string
          active_to: string | null
          body: string
          created_at: string
          created_by: string | null
          cta_href: string | null
          cta_label: string
          cta_to: string | null
          headline: string
          id: string
          source: string | null
          updated_at: string
        }
        Insert: {
          active_from?: string
          active_to?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label: string
          cta_to?: string | null
          headline: string
          id?: string
          source?: string | null
          updated_at?: string
        }
        Update: {
          active_from?: string
          active_to?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label?: string
          cta_to?: string | null
          headline?: string
          id?: string
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_moves_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_circle_subscription_snapshot: {
        Args: {
          _observed_at: string
          _paid_through: string
          _review_reason?: string
          _row: Json
        }
        Returns: boolean
      }
      audit_email_queues: { Args: never; Returns: Json }
      begin_circle_calendar_create: {
        Args: { _cadence_date: string }
        Returns: Json
      }
      begin_stripe_webhook_event: {
        Args: { _event_id: string; _event_type: string; _object_id: string }
        Returns: string
      }
      can_read_replay_category: {
        Args: {
          _category: Database["public"]["Enums"]["replay_category"]
          _user_id: string
        }
        Returns: boolean
      }
      circle_billing_identity_approved: {
        Args: {
          _billing_email: string
          _hub_email: string
          _hub_user_id: string
          _source_id: string
          _stripe_customer_id: string
          _stripe_subscription_id: string
        }
        Returns: boolean
      }
      claim_circle_audience_sync: {
        Args: { _email?: string }
        Returns: {
          attempts: number
          email: string
          last_error: string | null
          revision: number
          status: string
          synced_at: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "circle_audience_sync"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_default_calendar: {
        Args: { _schedule_id: string }
        Returns: string
      }
      finish_circle_audience_sync: {
        Args: {
          _attempt: number
          _email: string
          _error: string
          _revision: number
          _status: string
        }
        Returns: undefined
      }
      finish_stripe_webhook_event: {
        Args: { _event_id: string; _last_error?: string; _status: string }
        Returns: undefined
      }
      get_circle_entitlement: {
        Args: { _email: string; _user_id: string }
        Returns: Json
      }
      get_user_aos_limits: {
        Args: { _user_id: string }
        Returns: {
          seat_limit: number
          tier: Database["public"]["Enums"]["app_tier"]
          workspace_limit: number
        }[]
      }
      get_user_aos_limits_by_email: {
        Args: { _email: string }
        Returns: {
          seat_limit: number
          tier: Database["public"]["Enums"]["app_tier"]
          workspace_limit: number
        }[]
      }
      get_user_tier: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_tier"]
      }
      has_active_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tier_at_least: {
        Args: {
          _min: Database["public"]["Enums"]["app_tier"]
          _user_id: string
        }
        Returns: boolean
      }
      is_schedule_member: {
        Args: { _schedule_id: string; _user_id: string }
        Returns: boolean
      }
      mcp_abuse_cap_check: {
        Args: { _daily?: number; _hourly?: number }
        Returns: Json
      }
      mcp_abuse_cap_hit: { Args: never; Returns: boolean }
      mcp_accept_terms: {
        Args: {
          _authorization?: string
          _context?: string
          _url: string
          _user_agent?: string
          _version: string
        }
        Returns: string
      }
      mcp_add_item: { Args: { _f: Json; _job: string }; Returns: Json }
      mcp_answer: {
        Args: {
          _answer: string
          _detail: string
          _job: string
          _key: string
          _needed_by: string
          _owner: string
        }
        Returns: Json
      }
      mcp_assert_active: { Args: never; Returns: undefined }
      mcp_assert_job: {
        Args: { _job: string }
        Returns: {
          company_id: string | null
          contract_completion_date: string | null
          created_at: string
          id: string
          job_number: string | null
          name: string
          pm_email: string | null
          pm_name: string | null
          pm_title: string | null
          pm_user_id: string | null
          restricted: boolean
          sov_basis: string | null
          sov_fee_pct: number | null
          submittal_kickoff_at: string | null
          submittal_posture: string | null
          submittal_review_days: number
          time_zone: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mcp_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mcp_assert_job_scope: { Args: { _job: string }; Returns: string }
      mcp_assert_sov_total: {
        Args: { _facts: Json; _fee: number; _job: string }
        Returns: undefined
      }
      mcp_audit: {
        Args: {
          _action: string
          _company: string
          _job_number: string
          _object: string
          _tool: string
        }
        Returns: undefined
      }
      mcp_audit_job: {
        Args: { _action: string; _job: string; _object: string; _tool: string }
        Returns: undefined
      }
      mcp_billing_document_link: {
        Args: {
          _actor: string
          _document: string
          _invoice: string
          _job: string
          _receipt: string
          _version: number
        }
        Returns: Json
      }
      mcp_billing_document_register: {
        Args: {
          _actor: string
          _id: string
          _job: string
          _sha256: string
          _size: number
        }
        Returns: Json
      }
      mcp_billing_documents_get: { Args: { _job: string }; Returns: Json }
      mcp_billing_evidence_get: { Args: { _job: string }; Returns: Json }
      mcp_billing_evidence_record: {
        Args: { _action: string; _job: string; _p: Json }
        Returns: Json
      }
      mcp_billing_posted_credits: {
        Args: { _exclude?: string; _invoice: string; _job: string }
        Returns: number
      }
      mcp_billing_record_document: {
        Args: { _action: string; _actor: string; _job: string; _p: Json }
        Returns: Json
      }
      mcp_billing_upload_begin: {
        Args: {
          _filename: string
          _job: string
          _mime: string
          _token_hash: string
        }
        Returns: Json
      }
      mcp_billing_upload_claim: {
        Args: { _actor: string; _id: string; _token_hash: string }
        Returns: Json
      }
      mcp_billing_upload_get: {
        Args: { _id: string; _job: string }
        Returns: Json
      }
      mcp_board_link_create: {
        Args: { _expires_at: string; _job: string; _token_hash: string }
        Returns: Json
      }
      mcp_board_link_open: {
        Args: { _job: string; _page: string; _token_hash: string }
        Returns: Json
      }
      mcp_board_link_revoke: { Args: { _token_hash: string }; Returns: Json }
      mcp_caller_is_no_access_role: { Args: never; Returns: boolean }
      mcp_can_access_contract: { Args: { _job: string }; Returns: boolean }
      mcp_can_access_job: { Args: { _job: string }; Returns: boolean }
      mcp_can_view_job: { Args: { _job: string }; Returns: boolean }
      mcp_canary_for: { Args: { _company: string }; Returns: string }
      mcp_change_log_open: {
        Args: { _job: string; _token_hash: string }
        Returns: Json
      }
      mcp_change_price: { Args: { _lines: Json }; Returns: Json }
      mcp_change_record: {
        Args: { _action: string; _job: string; _p: Json }
        Returns: Json
      }
      mcp_change_rows: { Args: { _job: string }; Returns: Json }
      mcp_clause_norm: { Args: { _s: string }; Returns: string }
      mcp_clauses_save: {
        Args: { _clauses: Json; _doc: Json; _job: string }
        Returns: Json
      }
      mcp_clean_pm_name: { Args: { _s: string }; Returns: string }
      mcp_commercial_package_read: {
        Args: { _submittal: string }
        Returns: boolean
      }
      mcp_company_brand_save: {
        Args: { _company: string; _p: Json }
        Returns: undefined
      }
      mcp_company_plan_live: { Args: { _company: string }; Returns: boolean }
      mcp_company_save: {
        Args: { _company: string; _p: Json }
        Returns: string
      }
      mcp_company_tier: { Args: { _company: string }; Returns: string }
      mcp_contract_check_key: { Args: { _key: string }; Returns: boolean }
      mcp_contract_document_save: {
        Args: { _job: string; _p: Json }
        Returns: Json
      }
      mcp_cost_accounting_action: {
        Args: { _confirmed: boolean; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_cost_accounting_authorized: {
        Args: { _company: string }
        Returns: boolean
      }
      mcp_cost_active_paid: { Args: { _record: string }; Returns: number }
      mcp_cost_currency_supported: { Args: { _code: string }; Returns: boolean }
      mcp_cost_field_own_read: { Args: { _job: string }; Returns: Json }
      mcp_cost_field_submit: {
        Args: { _confirmed: boolean; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_cost_own_field_receipt_access: {
        Args: { _job: string; _record: string }
        Returns: boolean
      }
      mcp_cost_pm_approve: {
        Args: { _confirmed: boolean; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_cost_pm_payment_ready: {
        Args: { _record: string; _version: number }
        Returns: boolean
      }
      mcp_cost_pm_review: { Args: { _job: string }; Returns: Json }
      mcp_cost_pm_withdraw: {
        Args: { _confirmed: boolean; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_cost_receipt_get: {
        Args: { _id: string; _job: string; _record: string }
        Returns: Json
      }
      mcp_cost_receipt_list: {
        Args: { _job: string; _record: string }
        Returns: Json
      }
      mcp_cost_receipt_register: {
        Args: {
          _actor: string
          _id: string
          _job: string
          _record: string
          _sha256: string
          _size: number
        }
        Returns: Json
      }
      mcp_cost_receipt_upload_begin: {
        Args: {
          _filename: string
          _job: string
          _mime: string
          _record: string
          _token_hash: string
        }
        Returns: Json
      }
      mcp_cost_receipt_upload_claim: {
        Args: { _actor: string; _id: string; _token_hash: string }
        Returns: Json
      }
      mcp_cost_receipt_upload_get: {
        Args: { _id: string; _job: string; _record: string }
        Returns: Json
      }
      mcp_cost_reconciliation_snapshot: {
        Args: { _job: string }
        Returns: Json
      }
      mcp_cost_reference_in_use: {
        Args: { _company: string; _reference: string }
        Returns: boolean
      }
      mcp_cost_review_consume: {
        Args: { _job: string; _p: Json; _purpose: string; _review: string }
        Returns: undefined
      }
      mcp_cost_review_prepare: {
        Args: { _job: string; _p: Json; _purpose: string }
        Returns: Json
      }
      mcp_cost_settlement_action: {
        Args: { _confirmed: boolean; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_cost_shared_identity_validated: {
        Args: { _company: string; _records: string[] }
        Returns: boolean
      }
      mcp_cost_submission_read: { Args: { _job: string }; Returns: Json }
      mcp_cost_submission_save: {
        Args: { _confirmed: boolean; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_cost_valid_date: { Args: { _date: string }; Returns: boolean }
      mcp_cost_validate_project_refs: {
        Args: {
          _company: string
          _job: string
          _party: string
          _po: string
          _version: number
        }
        Returns: boolean
      }
      mcp_daily_reminder_mark_shown: {
        Args: { _day: string; _job: string }
        Returns: Json
      }
      mcp_daily_reminder_save: {
        Args: { _enabled: boolean; _job: string; _send: string; _tz: string }
        Returns: Json
      }
      mcp_daily_reminder_status: {
        Args: { _job_number: string }
        Returns: Json
      }
      mcp_daily_report_get: {
        Args: { _date: string; _job: string }
        Returns: Json
      }
      mcp_daily_report_save: {
        Args: {
          _confirmed: boolean
          _date: string
          _delays: string
          _deliveries: string
          _issues: string
          _job: string
          _lines: Json
          _manpower: string
          _safety: string
          _subs: string
          _transcript: string
          _weather: string
        }
        Returns: Json
      }
      mcp_deadline_add: {
        Args: { _d: Json; _due: string; _job: string }
        Returns: Json
      }
      mcp_decline_reenable: {
        Args: { _job: string; _na_id: string }
        Returns: Json
      }
      mcp_delay_event_add: {
        Args: { _claim: Json; _d: Json; _job: string; _notice: Json }
        Returns: Json
      }
      mcp_document_path_scope: { Args: { _name: string }; Returns: string }
      mcp_drawing_markup_save: {
        Args: { _job: string; _record: Json; _source: string }
        Returns: Json
      }
      mcp_drawing_path_allowed: { Args: { _path: string }; Returns: boolean }
      mcp_drawing_records: { Args: { _job: string }; Returns: Json }
      mcp_drawing_source_save: {
        Args: { _job: string; _record: Json }
        Returns: Json
      }
      mcp_estimate_bid_get: { Args: { _job: string }; Returns: Json }
      mcp_estimate_bid_save: {
        Args: { _job: string; _overhead: number; _profit: number }
        Returns: Json
      }
      mcp_estimate_gaps_save: {
        Args: { _items: Json; _job: string }
        Returns: Json
      }
      mcp_estimate_gc_save: {
        Args: {
          _days: number
          _finish: string
          _job: string
          _lines: Json
          _start: string
        }
        Returns: Json
      }
      mcp_estimate_get: { Args: { _job: string }; Returns: Json }
      mcp_estimate_guard: { Args: { _job: string }; Returns: string }
      mcp_estimate_pricing_save: {
        Args: {
          _job: string
          _labor: Json
          _material: Json
          _quotes: Json
          _sources: Json
        }
        Returns: Json
      }
      mcp_estimate_profile_get: { Args: { _job: string }; Returns: Json }
      mcp_estimate_profile_save: {
        Args: { _faces: number; _job: string; _profile: string }
        Returns: Json
      }
      mcp_estimate_requirements_save: {
        Args: { _items: Json; _job: string }
        Returns: Json
      }
      mcp_estimate_setup_save: {
        Args: { _job: string; _patch: Json }
        Returns: Json
      }
      mcp_estimate_takeoff_save: {
        Args: { _job: string; _lines: Json; _revision: string; _scales: Json }
        Returns: Json
      }
      mcp_estimate_verdict_save: {
        Args: {
          _gap: string
          _item: string
          _job: string
          _kind: string
          _line_no: number
          _mark: string
          _note: string
          _owner: string
          _qty: number
        }
        Returns: Json
      }
      mcp_eval_cond: { Args: { _c: Json; _flags: Json }; Returns: boolean }
      mcp_extra_seats: { Args: { _company: string }; Returns: number }
      mcp_field_activity_save: {
        Args: {
          _activity: string
          _crew: number
          _job: string
          _self: boolean
          _sub: string
        }
        Returns: Json
      }
      mcp_field_board: { Args: { _job: string }; Returns: Json }
      mcp_field_daily_page: { Args: { _job: string }; Returns: Json }
      mcp_field_guard: { Args: { _job: string }; Returns: string }
      mcp_field_photo_page: { Args: { _job: string }; Returns: Json }
      mcp_field_reminder_mark: {
        Args: { _day: string; _job: string }
        Returns: Json
      }
      mcp_field_reminder_preview: { Args: { _job: string }; Returns: Json }
      mcp_file_path_scope: { Args: { _name: string }; Returns: string }
      mcp_file_share_create: {
        Args: {
          _expires_at: string
          _filename: string
          _id: string
          _job: string
          _kind: string
          _mime: string
          _path: string
          _sha256: string
          _signed_url: string
          _size: number
          _token_hash: string
        }
        Returns: Json
      }
      mcp_file_share_list: { Args: { _job: string }; Returns: Json }
      mcp_file_share_open: {
        Args: { _count?: boolean; _token_hash: string }
        Returns: Json
      }
      mcp_file_share_open_before_packages: {
        Args: { _count?: boolean; _token_hash: string }
        Returns: Json
      }
      mcp_file_share_revoke: {
        Args: { _job: string; _token_hash: string }
        Returns: Json
      }
      mcp_file_upload_begin: {
        Args: {
          _filename: string
          _job: string
          _mime: string
          _new_piece: Json
          _piece: string
          _purpose: string
          _submittal: string
          _token_hash: string
        }
        Returns: Json
      }
      mcp_file_upload_chunk: {
        Args: { _id: string; _index: number; _job: string }
        Returns: Json
      }
      mcp_file_upload_complete: {
        Args: { _id: string; _job: string; _result: Json }
        Returns: Json
      }
      mcp_file_upload_get: {
        Args: { _id: string; _job: string }
        Returns: Json
      }
      mcp_flags_unknown: {
        Args: { _job: string; _keys: string[] }
        Returns: Json
      }
      mcp_gate: { Args: never; Returns: boolean }
      mcp_getting_started_claim: { Args: never; Returns: Json }
      mcp_guided_latest: {
        Args: { _flow: string; _job: string }
        Returns: Json
      }
      mcp_guided_save: {
        Args: { _flow: string; _job: string; _snapshot: Json; _stage: string }
        Returns: Json
      }
      mcp_has_right: {
        Args: { _company: string; _right: string }
        Returns: boolean
      }
      mcp_is_company_leader: { Args: { _company: string }; Returns: boolean }
      mcp_is_company_member: { Args: { _company: string }; Returns: boolean }
      mcp_is_company_owner: { Args: { _company: string }; Returns: boolean }
      mcp_is_company_viewer: { Args: { _company: string }; Returns: boolean }
      mcp_is_pm_ref: { Args: { _label: string; _pm: string }; Returns: boolean }
      mcp_is_super_view: { Args: { _job: string }; Returns: boolean }
      mcp_is_test_caller: { Args: never; Returns: boolean }
      mcp_job_create: {
        Args: {
          _company: string
          _job_number: string
          _name: string
          _restrict_to: string[]
        }
        Returns: Json
      }
      mcp_job_flagset: { Args: { _job: string }; Returns: Json }
      mcp_job_scope: { Args: { _job: string }; Returns: string }
      mcp_job_settings: {
        Args: {
          _job: string
          _pm_email?: string
          _pm_name: string
          _pm_title?: string
          _time_zone: string
        }
        Returns: Json
      }
      mcp_job_sov_terms: {
        Args: { _basis: string; _fee_pct: number; _job: string }
        Returns: undefined
      }
      mcp_latest_setup_checks: {
        Args: never
        Returns: {
          active: boolean
          applies_when: Json
          category: string
          created_at: string
          display_label: string | null
          id: string
          is_placeholder: boolean
          key: string
          module: string
          no_is_gap: boolean
          no_recommendation: string | null
          position: number
          prompt: string
          record_ref: string | null
          required_inputs: string[]
          rule_type: string
          section: string | null
          sets_flag: string | null
          severity: string
          superseded_at: string | null
          superseded_reason: string | null
          trade: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "mcp_checklist_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mcp_living_report_get: {
        Args: { _job: string; _type: string; _version?: number }
        Returns: Json
      }
      mcp_living_report_save: {
        Args: {
          _activity_count: number
          _base_version: number
          _completion?: string
          _contract_total: number
          _data: Json
          _data_date: string
          _forecast_total: number
          _job: string
          _replace_completion?: boolean
          _type: string
          _what: string
          _who: string
          _why: string
        }
        Returns: Json
      }
      mcp_living_strip_money: { Args: { _data: Json }; Returns: Json }
      mcp_log_surfaced: { Args: { _refs: Json }; Returns: undefined }
      mcp_mark_na: {
        Args: { _job: string; _reason: string; _scope: string; _target: string }
        Returns: Json
      }
      mcp_meeting_item_save: {
        Args: { _action: string; _close: boolean; _job: string; _key: string }
        Returns: Json
      }
      mcp_member_add: {
        Args: {
          _company: string
          _display_name: string
          _email: string
          _role: string
        }
        Returns: string
      }
      mcp_member_role: { Args: { _company: string }; Returns: string }
      mcp_morning_brief_candidates: { Args: never; Returns: Json }
      mcp_morning_brief_card_status: { Args: never; Returns: Json }
      mcp_morning_brief_feed: { Args: never; Returns: Json }
      mcp_morning_brief_feed_for: { Args: { _user: string }; Returns: Json }
      mcp_morning_brief_mark_sent: {
        Args: { _body: string; _day: string; _user: string }
        Returns: Json
      }
      mcp_morning_brief_mark_shown:
        | { Args: never; Returns: Json }
        | { Args: { _day: string }; Returns: Json }
      mcp_morning_brief_settings_get: { Args: never; Returns: Json }
      mcp_morning_brief_settings_save: {
        Args: { _enabled: boolean; _send: string; _tz: string }
        Returns: Json
      }
      mcp_morning_brief_shows: { Args: never; Returns: Json }
      mcp_next_check: { Args: { _job: string }; Returns: Json }
      mcp_normalize_role: { Args: { _role: string }; Returns: string }
      mcp_open_item_create: { Args: { _f: Json; _job: string }; Returns: Json }
      mcp_pm_email_in: { Args: { _s: string }; Returns: string }
      mcp_pm_label: { Args: { _job: string }; Returns: string }
      mcp_progress_photo_create: {
        Args: {
          _activity: string
          _area: string
          _client_safe: boolean
          _id: string
          _job: string
          _mime: string
          _path: string
          _size: number
          _sov: string
          _taken: string
          _work: string
        }
        Returns: Json
      }
      mcp_progress_photos_list: {
        Args: {
          _area: string
          _client_safe: boolean
          _from: string
          _item: string
          _job: string
          _to: string
        }
        Returns: Json
      }
      mcp_project_po_terms_get: { Args: { _job: string }; Returns: Json }
      mcp_project_purchase_orders_get: { Args: { _job: string }; Returns: Json }
      mcp_project_purchase_orders_record: {
        Args: {
          _action: string
          _confirmed: boolean
          _job: string
          _p: Json
          _review: string
        }
        Returns: Json
      }
      mcp_project_purchase_orders_review: {
        Args: { _action: string; _job: string; _p: Json; _review: string }
        Returns: Json
      }
      mcp_project_record_add:
        | {
            Args: {
              _actor: string
              _counterparty_email: string
              _counterparty_name: string
              _job: string
              _kind: string
              _payload: Json
              _ref_id: string
              _ref_table: string
              _summary: string
              _title: string
            }
            Returns: string
          }
        | {
            Args: {
              _actor: string
              _counterparty_email: string
              _counterparty_name: string
              _host: string
              _job: string
              _kind: string
              _payload: Json
              _ref_id: string
              _ref_table: string
              _summary: string
              _thread_ref: string
              _title: string
            }
            Returns: string
          }
      mcp_project_record_search: {
        Args: {
          _from: string
          _job: string
          _kind: string
          _q: string
          _to: string
        }
        Returns: Json
      }
      mcp_push_due: { Args: never; Returns: Json }
      mcp_push_log_send: {
        Args: {
          _error: string
          _http: number
          _job: string
          _kind: string
          _status: string
          _subscription: string
          _user: string
        }
        Returns: Json
      }
      mcp_push_mark_dead: { Args: { _id: string }; Returns: Json }
      mcp_push_mark_sent: { Args: { _day: string; _id: string }; Returns: Json }
      mcp_push_subscription_save: {
        Args: {
          _auth: string
          _endpoint: string
          _job: string
          _p256dh: string
        }
        Returns: Json
      }
      mcp_push_test_targets: { Args: { _job: string }; Returns: Json }
      mcp_rate_hit: { Args: { _limit?: number }; Returns: boolean }
      mcp_reenable: {
        Args: { _job: string; _scope: string; _target: string }
        Returns: Json
      }
      mcp_repoint_pm_items: { Args: { _job: string }; Returns: number }
      mcp_report_latest_lookahead: { Args: { _job: string }; Returns: Json }
      mcp_report_open_items: {
        Args: { _job: string; _super: boolean }
        Returns: Json
      }
      mcp_report_page_get: {
        Args: { _company?: string; _job: string; _page: string }
        Returns: Json
      }
      mcp_report_page_stamp: {
        Args: { _company?: string; _job: string; _page: string }
        Returns: string
      }
      mcp_report_portfolio_rows: {
        Args: { _company: string; _money: boolean }
        Returns: Json
      }
      mcp_report_share_create: {
        Args: {
          _company: string
          _expires_at: string
          _job: string
          _page: string
          _token_hash: string
        }
        Returns: Json
      }
      mcp_report_share_open: { Args: { _token_hash: string }; Returns: Json }
      mcp_report_share_revoke: { Args: { _token_hash: string }; Returns: Json }
      mcp_request_log_open: {
        Args: { _job: string; _kind: string; _token_hash: string }
        Returns: Json
      }
      mcp_request_package_content: { Args: { _details: Json }; Returns: Json }
      mcp_request_record: {
        Args: { _action: string; _job: string; _kind: string; _p: Json }
        Returns: Json
      }
      mcp_request_rows: { Args: { _job: string; _kind: string }; Returns: Json }
      mcp_resolve_item: {
        Args: {
          _approval: string
          _billing: string
          _collection: string
          _evidence: string
          _item: string
          _kind: string
          _reason: string
          _stated_by: string
          _stated_on: string
        }
        Returns: Json
      }
      mcp_resolve_job: {
        Args: { _company: string; _job_number: string }
        Returns: Json
      }
      mcp_role_allowed: {
        Args: { _company: string; _role: string }
        Returns: boolean
      }
      mcp_seat_usage: { Args: { _company: string }; Returns: Json }
      mcp_security_digest: {
        Args: { _since: string }
        Returns: {
          calls: number
          company: string
          flags: number
          kinds: string[]
          member: string
          tool: string
        }[]
      }
      mcp_security_touch: {
        Args: {
          _job_number: string
          _signals: Json
          _soft_lock: boolean
          _soft_lock_flags: number
          _tool: string
          _tool_hourly: number
        }
        Returns: Json
      }
      mcp_session_touch: { Args: never; Returns: boolean }
      mcp_set_current_company: {
        Args: { _company: string }
        Returns: undefined
      }
      mcp_set_facts: {
        Args: { _facts: Json; _job: string; _module: string; _source: string }
        Returns: Json
      }
      mcp_set_flags: {
        Args: { _flags: Json; _job: string; _source: string }
        Returns: Json
      }
      mcp_submittal_chase_due: { Args: never; Returns: Json }
      mcp_submittal_chase_mark: {
        Args: {
          _email: string
          _job: string
          _name: string
          _subject: string
          _submittal: string
        }
        Returns: Json
      }
      mcp_submittal_chase_rows: { Args: { _job: string }; Returns: Json }
      mcp_submittal_delivery: {
        Args: { _action: string; _job: string; _p: Json; _submittal: string }
        Returns: Json
      }
      mcp_submittal_items_write: {
        Args: {
          _company: string
          _items: Json
          _job: string
          _submittal: string
        }
        Returns: undefined
      }
      mcp_submittal_log: {
        Args: { _action: string; _job: string; _payload: Json }
        Returns: Json
      }
      mcp_submittal_package_context: {
        Args: { _job: string; _submittal: string }
        Returns: Json
      }
      mcp_submittal_package_reserve: {
        Args: { _fingerprint: string; _job: string; _submittal: string }
        Returns: Json
      }
      mcp_submittal_package_write: {
        Args: { _action: string; _job: string; _p: Json; _submittal: string }
        Returns: Json
      }
      mcp_submittal_page: { Args: { _job: string }; Returns: Json }
      mcp_submittal_path_scope: { Args: { _name: string }; Returns: string }
      mcp_submittal_preview: {
        Args: {
          _job: string
          _package: string
          _signed_url: string
          _token_hash: string
        }
        Returns: undefined
      }
      mcp_submittal_preview_open: {
        Args: { _count?: boolean; _token_hash: string }
        Returns: Json
      }
      mcp_submittal_record: {
        Args: { _id: string; _issued: boolean; _job: string; _kind: string }
        Returns: undefined
      }
      mcp_submittal_record_get: {
        Args: { _job: string; _number: string }
        Returns: Json
      }
      mcp_submittal_record_open: {
        Args: { _job: string; _number: string; _token_hash: string }
        Returns: Json
      }
      mcp_submittal_record_stamp: {
        Args: { _job: string; _number: string }
        Returns: string
      }
      mcp_submittal_rows: { Args: { _job: string }; Returns: Json }
      mcp_submittal_rows_before_packages: {
        Args: { _job: string }
        Returns: Json
      }
      mcp_takeoff_accept_batch: {
        Args: { _decisions: Json; _job: string; _page: number; _source: string }
        Returns: Json
      }
      mcp_takeoff_calibrate: {
        Args: {
          _expected: number
          _job: string
          _page: number
          _record: Json
          _source: string
        }
        Returns: Json
      }
      mcp_takeoff_canonical_points: {
        Args: { _points: Json; _ring?: boolean }
        Returns: Json
      }
      mcp_takeoff_cross: {
        Args: { a: Json; b: Json; c: Json }
        Returns: number
      }
      mcp_takeoff_exports: {
        Args: { _id?: string; _job: string; _page?: number; _source?: string }
        Returns: Json
      }
      mcp_takeoff_geometry_save: {
        Args: {
          _expected: number
          _job: string
          _operation: string
          _record: Json
        }
        Returns: Json
      }
      mcp_takeoff_get: { Args: { _job: string }; Returns: Json }
      mcp_takeoff_history: {
        Args: { _geometry?: string; _job: string; _line?: number }
        Returns: Json
      }
      mcp_takeoff_inside: { Args: { p: Json; r: Json }; Returns: boolean }
      mcp_takeoff_intersects: {
        Args: { a: Json; b: Json; c: Json; d: Json }
        Returns: boolean
      }
      mcp_takeoff_line_map: {
        Args: { _current: string; _previous: string }
        Returns: {
          new_id: string
          new_line_no: number
          old_id: string
          old_line_no: number
        }[]
      }
      mcp_takeoff_markup_save: {
        Args: { _job: string; _record: Json }
        Returns: Json
      }
      mcp_takeoff_measure: {
        Args: { _height: number; _scale: number; _shape: Json; _width: number }
        Returns: Json
      }
      mcp_takeoff_on: { Args: { a: Json; b: Json; p: Json }; Returns: boolean }
      mcp_takeoff_pass_save: {
        Args: { _job: string; _record: Json }
        Returns: Json
      }
      mcp_takeoff_points: {
        Args: { _minimum: number; _points: Json }
        Returns: undefined
      }
      mcp_takeoff_ring_area: { Args: { _points: Json }; Returns: number }
      mcp_takeoff_signature: { Args: { _shape: Json }; Returns: Json }
      mcp_takeoff_validate_area: { Args: { s: Json }; Returns: undefined }
      mcp_takeoff_validate_ring: { Args: { r: Json }; Returns: undefined }
      mcp_takeoff_write: {
        Args: {
          _expected: number
          _geometries: Json
          _job: string
          _lines: Json
          _revision: string
          _scales: Json
        }
        Returns: Json
      }
      mcp_team_accept_invites: { Args: never; Returns: number }
      mcp_team_assert_owner: { Args: { _company: string }; Returns: undefined }
      mcp_team_check_role: {
        Args: { _company: string; _role: string }
        Returns: string
      }
      mcp_team_invite: {
        Args: {
          _company: string
          _display_name: string
          _email: string
          _jobs: string[]
          _role: string
        }
        Returns: Json
      }
      mcp_team_job_ids: {
        Args: { _company: string; _jobs: string[] }
        Returns: string[]
      }
      mcp_team_list: { Args: { _company: string }; Returns: Json }
      mcp_team_log: {
        Args: {
          _action: string
          _after: Json
          _before: Json
          _company: string
          _email: string
          _target: string
        }
        Returns: undefined
      }
      mcp_team_remove_member: {
        Args: { _company: string; _email: string; _user: string }
        Returns: Json
      }
      mcp_team_snapshot: {
        Args: { _company: string; _user: string }
        Returns: Json
      }
      mcp_team_update_member: {
        Args: {
          _company: string
          _jobs: string[]
          _role: string
          _user: string
        }
        Returns: Json
      }
      mcp_usage_hit: { Args: { _limit: number }; Returns: Json }
      mcp_user_push_mark_dead: { Args: { _id: string }; Returns: Json }
      mcp_user_push_subscribed: { Args: never; Returns: boolean }
      mcp_user_push_subscription_save: {
        Args: { _auth: string; _endpoint: string; _p256dh: string }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      open_support_ticket: {
        Args: {
          _brand: string
          _from_email: string
          _message_id: string
          _raw_summary: string
          _received_at: string
          _resend_email_id: string
          _subject: string
        }
        Returns: {
          autoreply_sent_at: string
          autoreply_suppressed_reason: string
          brand: string
          from_email: string
          id: string
          inserted: boolean
          message_id: string
          notify_sent_at: string
          raw_summary: string
          received_at: string
          resend_email_id: string
          status: string
          subject: string
          ticket_number: string
        }[]
      }
      publish_circle_calendar_session: {
        Args: {
          _cadence_date: string
          _calendar_id: string
          _calendar_updated_at: string
          _conference_status: string
          _description?: string
          _duration_min: number
          _event_id: string
          _meeting_url: string
          _rollover_enabled?: boolean
          _starts_at: string
          _time_zone: string
          _title: string
        }
        Returns: string
      }
      publish_circle_reserved_session: {
        Args: {
          _cadence_date: string
          _calendar_id: string
          _description?: string
          _ends_at: string
          _event_id: string
          _event_status: string
          _is_recurring: boolean
          _meeting_url: string
          _starts_at: string
          _time_zone: string
          _title: string
        }
        Returns: string
      }
      queue_circle_audience_sweep: { Args: never; Returns: undefined }
      queue_circle_audience_sync: {
        Args: { _email: string }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_circle_calendar_event: {
        Args: {
          _attempt_id: string
          _cadence_date: string
          _event_id: string
          _marker: string
        }
        Returns: {
          attempt_id: string | null
          attempted_at: string | null
          cadence_date: string
          calendar_event_id: string | null
          calendar_id: string
          created_at: string
          marker: string
          session_id: string | null
          source_cadence_date: string
          source_event_id: string
          source_meeting_url: string
          source_session_id: string | null
          source_starts_at: string
          source_version: number | null
          starts_at: string
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "circle_calendar_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_schedule_graph: {
        Args: { _dependencies: Json; _schedule_id: string; _tasks: Json }
        Returns: undefined
      }
      reserve_circle_rollover: {
        Args: { _expected_version: number; _source_id: string }
        Returns: {
          attempt_id: string | null
          attempted_at: string | null
          cadence_date: string
          calendar_event_id: string | null
          calendar_id: string
          created_at: string
          marker: string
          session_id: string | null
          source_cadence_date: string
          source_event_id: string
          source_meeting_url: string
          source_session_id: string | null
          source_starts_at: string
          source_version: number | null
          starts_at: string
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "circle_calendar_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_circle_owner_grant: {
        Args: {
          _actor: string
          _email: string
          _enabled: boolean
          _expires_at?: string
          _reason: string
          _subscription_id: string
          _user_id: string
        }
        Returns: undefined
      }
      set_circle_source_alias: {
        Args: {
          _actor: string
          _billing_email: string
          _enabled: boolean
          _expected_source_email: string
          _expected_source_user_id: string
          _expected_stripe_customer_id: string
          _expected_stripe_subscription_id: string
          _expires_at?: string
          _reason: string
          _source_id: string
          _target_email: string
          _target_user_id: string
        }
        Returns: string
      }
      subscription_matches_identity: {
        Args: {
          _email: string
          _sub_email: string
          _sub_metadata: Json
          _sub_user_id: string
          _user_id: string
        }
        Returns: boolean
      }
      tier_rank: {
        Args: { _tier: Database["public"]["Enums"]["app_tier"] }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "member"
      app_tier:
        | "aos_only"
        | "book_buyer"
        | "contractor_school"
        | "intensive"
        | "circle"
        | "power_hour"
        | "sm_school"
        | "hardcore"
      replay_category:
        | "circle_call"
        | "power_hour"
        | "sm_school"
        | "contractor_school"
      schedule_member_role: "owner" | "scheduler" | "viewer"
      schedule_status: "planning" | "active" | "on_hold" | "closed"
      scheduler_dep_type: "FS" | "SS" | "FF" | "SF"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
      app_tier: [
        "aos_only",
        "book_buyer",
        "contractor_school",
        "intensive",
        "circle",
        "power_hour",
        "sm_school",
        "hardcore",
      ],
      replay_category: [
        "circle_call",
        "power_hour",
        "sm_school",
        "contractor_school",
      ],
      schedule_member_role: ["owner", "scheduler", "viewer"],
      schedule_status: ["planning", "active", "on_hold", "closed"],
      scheduler_dep_type: ["FS", "SS", "FF", "SF"],
    },
  },
} as const
