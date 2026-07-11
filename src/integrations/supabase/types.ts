export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      content_components: {
        Row: {
          body_md: string;
          effort: string;
          expires: string | null;
          housing_types: string[];
          impact: Json;
          kind: string;
          lanes: string[];
          last_verified: string;
          media: string[];
          prerequisites: string[];
          regions: string[];
          slug: string;
          sources: string[];
          status: string;
          summary: string;
          synced_at: string;
          technologies: string[];
          tenures: string[];
          title: string;
          version: number;
        };
        Insert: {
          body_md: string;
          effort: string;
          expires?: string | null;
          housing_types?: string[];
          impact: Json;
          kind: string;
          lanes?: string[];
          last_verified: string;
          media?: string[];
          prerequisites?: string[];
          regions?: string[];
          slug: string;
          sources?: string[];
          status: string;
          summary: string;
          synced_at?: string;
          technologies?: string[];
          tenures?: string[];
          title: string;
          version: number;
        };
        Update: {
          body_md?: string;
          effort?: string;
          expires?: string | null;
          housing_types?: string[];
          impact?: Json;
          kind?: string;
          lanes?: string[];
          last_verified?: string;
          media?: string[];
          prerequisites?: string[];
          regions?: string[];
          slug?: string;
          sources?: string[];
          status?: string;
          summary?: string;
          synced_at?: string;
          technologies?: string[];
          tenures?: string[];
          title?: string;
          version?: number;
        };
        Relationships: [];
      };
      content_media: {
        Row: {
          alt: string;
          caption: string;
          credit: Json;
          kind: string;
          regions: string[];
          slug: string;
          storage_path: string;
          synced_at: string;
          technologies: string[];
        };
        Insert: {
          alt: string;
          caption?: string;
          credit: Json;
          kind: string;
          regions?: string[];
          slug: string;
          storage_path: string;
          synced_at?: string;
          technologies?: string[];
        };
        Update: {
          alt?: string;
          caption?: string;
          credit?: Json;
          kind?: string;
          regions?: string[];
          slug?: string;
          storage_path?: string;
          synced_at?: string;
          technologies?: string[];
        };
        Relationships: [];
      };
      content_presets: {
        Row: {
          category: string;
          first_message: string;
          label: string;
          profile_patches: Json;
          regions: string[];
          slug: string;
          synced_at: string;
          tenures: string[];
        };
        Insert: {
          category: string;
          first_message: string;
          label: string;
          profile_patches?: Json;
          regions?: string[];
          slug: string;
          synced_at?: string;
          tenures?: string[];
        };
        Update: {
          category?: string;
          first_message?: string;
          label?: string;
          profile_patches?: Json;
          regions?: string[];
          slug?: string;
          synced_at?: string;
          tenures?: string[];
        };
        Relationships: [];
      };
      content_sources: {
        Row: {
          label: string;
          last_verified: string;
          publisher: string;
          slug: string;
          synced_at: string;
          url: string;
        };
        Insert: {
          label: string;
          last_verified: string;
          publisher: string;
          slug: string;
          synced_at?: string;
          url: string;
        };
        Update: {
          label?: string;
          last_verified?: string;
          publisher?: string;
          slug?: string;
          synced_at?: string;
          url?: string;
        };
        Relationships: [];
      };
      feedback: {
        Row: {
          comment: string | null;
          created_at: string;
          id: string;
          rating: string;
          session_id: string;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          rating: string;
          session_id: string;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          id?: string;
          rating?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          parts: Json | null;
          role: string;
          session_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          parts?: Json | null;
          role: string;
          session_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          parts?: Json | null;
          role?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          durable_profile: Json | null;
          id: string;
          persona: string | null;
        };
        Insert: {
          created_at?: string;
          durable_profile?: Json | null;
          id: string;
          persona?: string | null;
        };
        Update: {
          created_at?: string;
          durable_profile?: Json | null;
          id?: string;
          persona?: string | null;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          document: Json | null;
          id: string;
          key_insights: Json;
          next_steps: Json;
          persona: string | null;
          readiness_score: number | null;
          resources: Json;
          session_id: string;
          top_options: Json;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          document?: Json | null;
          id?: string;
          key_insights?: Json;
          next_steps?: Json;
          persona?: string | null;
          readiness_score?: number | null;
          resources?: Json;
          session_id: string;
          top_options?: Json;
          user_id: string;
        };
        Update: {
          created_at?: string;
          document?: Json | null;
          id?: string;
          key_insights?: Json;
          next_steps?: Json;
          persona?: string | null;
          readiness_score?: number | null;
          resources?: Json;
          session_id?: string;
          top_options?: Json;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          created_at: string;
          id: string;
          is_complete: boolean;
          profile: Json | null;
          readiness_reached_at: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_complete?: boolean;
          profile?: Json | null;
          readiness_reached_at?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_complete?: boolean;
          profile?: Json | null;
          readiness_reached_at?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
