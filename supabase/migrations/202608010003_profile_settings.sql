alter table public.encrypted_bank_settings
  add column profile jsonb not null default '{}'::jsonb,
  add column invoice_prefix text not null default 'INV'
    check (invoice_prefix ~ '^[A-Z0-9]{1,10}$');

alter table public.encrypted_bank_settings
  add constraint encrypted_bank_settings_profile_shape
  check (jsonb_typeof(profile) = 'object');
