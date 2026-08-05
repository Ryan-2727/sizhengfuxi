-- The initial migration was already applied before service_role privileges
-- were added. This grants database access only to local admin scripts.
grant all on table public.memberships to service_role;
grant all on table public.questions to service_role;
