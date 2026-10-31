-- Run this in the Supabase SQL editor after the design-templates-and-orders
-- migration. Adds customer notes and reference images to an order, captured
-- on the order review/confirmation screen before it's sent to the shop.

alter table public.design_orders
  add column if not exists notes text,
  add column if not exists reference_images jsonb not null default '[]'::jsonb;
