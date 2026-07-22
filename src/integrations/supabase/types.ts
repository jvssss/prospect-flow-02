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
      call_logs: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          lead_id: string | null
          nome_ponte: string | null
          notes: string | null
          outcome: string
          scheduled_return_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          lead_id?: string | null
          nome_ponte?: string | null
          notes?: string | null
          outcome: string
          scheduled_return_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          lead_id?: string | null
          nome_ponte?: string | null
          notes?: string | null
          outcome?: string
          scheduled_return_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          calls_made: number
          closes: number
          created_at: string
          day: string
          decisions_reached: number
          id: string
          meetings_held: number
          meetings_scheduled: number
          revenue: number
          updated_at: string
          user_id: string
        }
        Insert: {
          calls_made?: number
          closes?: number
          created_at?: string
          day?: string
          decisions_reached?: number
          id?: string
          meetings_held?: number
          meetings_scheduled?: number
          revenue?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          calls_made?: number
          closes?: number
          created_at?: string
          day?: string
          decisions_reached?: number
          id?: string
          meetings_held?: number
          meetings_scheduled?: number
          revenue?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      enrichment_jobs: {
        Row: {
          apify_run_id: string | null
          city: string
          created_at: string
          error: string | null
          id: string
          leads_created: number
          niche: string
          progress: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apify_run_id?: string | null
          city: string
          created_at?: string
          error?: string | null
          id?: string
          leads_created?: number
          niche?: string
          progress?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apify_run_id?: string | null
          city?: string
          created_at?: string
          error?: string | null
          id?: string
          leads_created?: number
          niche?: string
          progress?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      goals_math: {
        Row: {
          avg_ticket: number
          created_at: string
          hours_per_day: number
          id: string
          is_active: boolean
          monthly_revenue_target: number
          prospecting_days_per_week: number
          rate_call_to_decision: number
          rate_decision_to_meeting: number
          rate_meeting_to_close: number
          rate_show_up: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_ticket?: number
          created_at?: string
          hours_per_day?: number
          id?: string
          is_active?: boolean
          monthly_revenue_target?: number
          prospecting_days_per_week?: number
          rate_call_to_decision?: number
          rate_decision_to_meeting?: number
          rate_meeting_to_close?: number
          rate_show_up?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_ticket?: number
          created_at?: string
          hours_per_day?: number
          id?: string
          is_active?: boolean
          monthly_revenue_target?: number
          prospecting_days_per_week?: number
          rate_call_to_decision?: number
          rate_decision_to_meeting?: number
          rate_meeting_to_close?: number
          rate_show_up?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          bairro: string | null
          capital_social: number | null
          cidade: string | null
          closer_notes: string | null
          closer_summary: Json | null
          cnpj: string | null
          created_at: string
          data_abertura: string | null
          email: string | null
          endereco: string | null
          enrichment_job_id: string | null
          enrichment_status: string | null
          followup_at: string | null
          followup_notes: string | null
          google_rating: number | null
          google_reviews: number | null
          id: string
          last_call_at: string | null
          meeting_at: string | null
          meeting_link: string | null
          meeting_result: string | null
          meeting_status: string | null
          nome_fantasia: string | null
          nome_ponte: string | null
          notas: string | null
          pipeline_stage: string
          proprietario: string | null
          qsa: Json | null
          qualified_at: string | null
          razao_social: string | null
          retorno_agendado_em: string | null
          sdr_qualification: Json | null
          socios: Json | null
          source: string
          status: string
          telefone_1: string | null
          telefone_2: string | null
          uf: string | null
          updated_at: string
          user_id: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          bairro?: string | null
          capital_social?: number | null
          cidade?: string | null
          closer_notes?: string | null
          closer_summary?: Json | null
          cnpj?: string | null
          created_at?: string
          data_abertura?: string | null
          email?: string | null
          endereco?: string | null
          enrichment_job_id?: string | null
          enrichment_status?: string | null
          followup_at?: string | null
          followup_notes?: string | null
          google_rating?: number | null
          google_reviews?: number | null
          id?: string
          last_call_at?: string | null
          meeting_at?: string | null
          meeting_link?: string | null
          meeting_result?: string | null
          meeting_status?: string | null
          nome_fantasia?: string | null
          nome_ponte?: string | null
          notas?: string | null
          pipeline_stage?: string
          proprietario?: string | null
          qsa?: Json | null
          qualified_at?: string | null
          razao_social?: string | null
          retorno_agendado_em?: string | null
          sdr_qualification?: Json | null
          socios?: Json | null
          source?: string
          status?: string
          telefone_1?: string | null
          telefone_2?: string | null
          uf?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          bairro?: string | null
          capital_social?: number | null
          cidade?: string | null
          closer_notes?: string | null
          closer_summary?: Json | null
          cnpj?: string | null
          created_at?: string
          data_abertura?: string | null
          email?: string | null
          endereco?: string | null
          enrichment_job_id?: string | null
          enrichment_status?: string | null
          followup_at?: string | null
          followup_notes?: string | null
          google_rating?: number | null
          google_reviews?: number | null
          id?: string
          last_call_at?: string | null
          meeting_at?: string | null
          meeting_link?: string | null
          meeting_result?: string | null
          meeting_status?: string | null
          nome_fantasia?: string | null
          nome_ponte?: string | null
          notas?: string | null
          pipeline_stage?: string
          proprietario?: string | null
          qsa?: Json | null
          qualified_at?: string | null
          razao_social?: string | null
          retorno_agendado_em?: string | null
          sdr_qualification?: Json | null
          socios?: Json | null
          source?: string
          status?: string
          telefone_1?: string | null
          telefone_2?: string | null
          uf?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
