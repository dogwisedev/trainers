-- 042: When the "your chat is ready" reminder went to a client who hadn't opened their chat (sent once, 2 days after the invite).
-- No foreign keys. Run once in Supabase → SQL editor (after 041).
alter table chats add column if not exists join_reminded_at timestamptz;
notify pgrst, 'reload schema';
