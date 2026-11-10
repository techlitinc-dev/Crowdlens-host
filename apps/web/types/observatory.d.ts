/**
 * Fixture typings shared by the landing observatory and sample report.
 */

export interface ObservatorySegment {
  id: string;
  name: string;
  share: number;
  stance_default: number;
  nodes: number;
  active_share: number;
  summary: string;
  source_excerpt: { locator: string; text: string };
  agent_quote: string;
}

export interface ObservatoryFixture {
  fixture_version: string;
  label: string;
  scenario: {
    name: string;
    decision_question: string;
    total_ticks: number;
    default_tick: number;
    logical_population: number;
    active_reasoning: number;
    segments: ObservatorySegment[];
  };
  providers: { id: string; label: string; model_label: string; credit_rate: number; note: string }[];
  credit_model: { base_per_tick: number; currency: string; disclaimer: string };
  timeline: { tick: number; adoption: number; support: number; objection: number; uncertainty: number }[];
  segment_ticks: Record<string, Record<string, number>>;
  events: { tick: number; segment: string; type: string; label: string; provenance: string }[];
}

export interface SampleEvidence {
  type: string;
  id: string;
  relation: string;
  excerpt: string;
  provenance?: string;
}

export interface SampleClaim {
  claim_id: string;
  text: string;
  confidence_label: string;
  method: string;
  evidence: SampleEvidence[];
}

export interface SampleReport {
  fixture_version: string;
  label: string;
  title: string;
  summary: { recommendation: string; text: string };
  segments: { name: string; share: number; stance: string; delta: string; objections: string[]; evidence_count: number }[];
  claims: SampleClaim[];
  objection_timeline: { tick: number; label: string; intensity: number }[];
  method: Record<string, unknown>;
  limitations: string[];
  disclaimer: string;
}

export interface RateCardPublic {
  rate_card_version: string;
  currency: "INR";
  plans: {
    code: string;
    name: string;
    price_minor: number;
    interval: string;
    included_credits: number;
    agent_ceiling: number;
    seats: number;
    max_concurrent_runs: number;
    max_active_projects: number;
  }[];
  credit_packs: { code: string; credits: number; price_minor: number; currency: string }[];
  estimator: {
    population_tick_per_thousand: number;
    active_reasoning_call: number;
    graph_chunk: number;
    report_section: number;
    provider_multiplier: Record<string, number>;
    action_batch: number;
    low_factor: number;
    high_factor: number;
  };
  disclaimer: string;
}
