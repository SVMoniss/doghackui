-- Platform administrators: may do everything organizers can, plus grant and
-- revoke roles. Isolation-matrix-wise admin sees what organizers see.
alter type public.app_role add value if not exists 'admin';
