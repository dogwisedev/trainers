export type Role = "admin" | "trainer";
export type Trainer = {
  id: string; name: string; email: string | null; work_email: string | null; dogwise_email: string | null; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null; lat: number | null; lon: number | null;
  range_text: string | null; range_miles: number; capacity: number; monthly_capacity: number | null;
  programs: string | null; offering: string | null; notes: string | null; poc: string | null;
  shirt_size: string | null; second_location: string | null; local_vet: string | null; emergency_vet: string | null; emergency_contact: string | null;
  birthday: string | null; bio: string | null; photo_url?: string | null; active: boolean; data_flags: string[];
};
export type BookingStatus = "pending" | "confirmed" | "in_training" | "completed" | "cancelled";
export type Booking = {
  id: string; trainer_id: string; client_name: string; dog_name: string | null; program: string | null;
  start_date: string; end_date: string; weeks: number | null; status: BookingStatus; notes: string | null; hubspot_deal_id: string | null;
};
export type TimeOff = { id: string; trainer_id: string; start_date: string; end_date: string; slots_blocked: number | null; reason: string; note: string | null };
export type Message = { id: string; trainer_id: string; sender_role: Role; sender_name: string | null; body: string; created_at: string; read_at: string | null };
export type Viewer = { userId: string; role: Role; trainerId: string | null; name: string; demo: boolean };
