-- 071: Photos and videos on a weekly health check ("Snout to tail") wait with the form and only go into the dog's chat
-- when the office presses "Send media in chat" after approving it. When and by whom they were sent. Run once (after 070).
alter table reports add column if not exists media_sent_at timestamptz;
alter table reports add column if not exists media_sent_by text;
notify pgrst, 'reload schema';
