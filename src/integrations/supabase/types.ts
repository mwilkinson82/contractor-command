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
      replays: {
        Row: {
          category: Database["public"]["Enums"]["replay_category"]
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          published: boolean
          recorded_at: string
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
          id?: string
          published?: boolean
          recorded_at?: string
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
          id?: string
          published?: boolean
          recorded_at?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          video_url?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      finish_stripe_webhook_event: {
        Args: { _event_id: string; _last_error?: string; _status: string }
        Returns: undefined
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
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
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
