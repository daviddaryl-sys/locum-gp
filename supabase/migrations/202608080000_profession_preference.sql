alter table public.encrypted_bank_settings
  alter column ciphertext drop not null,
  alter column salt drop not null,
  alter column initialization_vector drop not null,
  alter column kdf_parameters drop not null,
  alter column encryption_version drop default,
  alter column encryption_version drop not null;

alter table public.encrypted_bank_settings
  add constraint encrypted_bank_settings_vault_all_or_none
  check (
    (
      ciphertext is null
      and salt is null
      and initialization_vector is null
      and kdf_parameters is null
      and encryption_version is null
    )
    or
    (
      ciphertext is not null and length(ciphertext) > 0
      and salt is not null and length(salt) > 0
      and initialization_vector is not null and length(initialization_vector) > 0
      and kdf_parameters is not null
      and kdf_parameters @? '$ ? (@.name == "PBKDF2" && @.hash == "SHA-256" && @.iterations >= 300000 && @.iterations <= 1000000)'
      and encryption_version = 1
    )
  ),
  add constraint encrypted_bank_settings_profession_value
  check (
    not (profile ? 'profession')
    or (
      jsonb_typeof(profile -> 'profession') = 'string'
      and profile ->> 'profession' in ('gp', 'pharmacist')
    )
  );
