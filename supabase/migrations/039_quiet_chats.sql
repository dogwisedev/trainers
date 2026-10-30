-- 039: Quiet chats. For dogs finishing their training on Signal: the app stops its "hasn't posted today", "client waiting" and
-- "unanswered messages" alerts for the chat, its client "new updates" emails and its automatic invite. Only the people in
-- QUIET_CHAT_EMAILS (default alma@dogwiseacademy.com) can quiet or unquiet a chat; the rest of the team just sees the label.
-- No foreign keys. Run once in Supabase → SQL editor (after 038).
alter table chats add column if not exists quiet_at timestamptz;   -- set = quiet
alter table chats add column if not exists quiet_by text;          -- who quieted it
notify pgrst, 'reload schema';
