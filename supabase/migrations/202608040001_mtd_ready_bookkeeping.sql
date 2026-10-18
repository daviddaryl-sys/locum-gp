alter table public.expense_records
  add column mtd_category text not null default 'other_business_expenses',
  add column allowable_percentage smallint not null default 100,
  add constraint expense_mtd_category_check check (mtd_category in (
    'cost_of_goods', 'construction_subcontractors', 'staff_costs',
    'travel_costs', 'premises_costs', 'repairs_maintenance',
    'office_costs', 'advertising', 'business_entertainment', 'interest',
    'financial_charges', 'professional_fees', 'other_business_expenses'
  )),
  add constraint expense_allowable_percentage_check
    check (allowable_percentage between 0 and 100);

update public.expense_records
set mtd_category = case
  when category_key in (
    'mileage_business_travel', 'public_transport_taxi',
    'parking_tolls_congestion', 'qualifying_accommodation',
    'qualifying_subsistence'
  ) then 'travel_costs'
  when category_key = 'practice_medical_supplies' then 'cost_of_goods'
  when category_key in (
    'practice_printing_phone_postage', 'computer_software_phone_internet'
  ) then 'office_costs'
  when category_key = 'home_office' then 'premises_costs'
  when category_key in (
    'professional_memberships', 'professional_training',
    'accountancy_legal_bank_fees'
  ) then 'professional_fees'
  else 'other_business_expenses'
end,
needs_accountant_review = needs_accountant_review
  or custom_category_id is not null
  or category_key in ('other_practice_specific', 'other_general');

comment on column public.expense_records.mtd_category is
  'HMRC self-employment expense category for bookkeeping/export; not proof of tax deductibility.';
comment on column public.expense_records.allowable_percentage is
  'Whole-number business-use percentage used for MTD-ready bookkeeping totals.';

alter table public.invoice_records
  add column paid_at date,
  add constraint invoice_paid_date_status_check
    check (paid_at is null or status = 'paid');

comment on column public.invoice_records.paid_at is
  'Date payment was received; used for cash-basis MTD-ready turnover totals.';
