do $$
declare
  function_definition text;
  ambiguous_reference text := 'and existing.source_fingerprint = source_fingerprint';
  qualified_reference text := 'and existing.source_fingerprint = (import_payload ->> ''source_fingerprint'')';
begin
  select pg_get_functiondef('public.apply_household_setup_import(jsonb)'::regprocedure)
    into function_definition;

  if position(ambiguous_reference in function_definition) > 0 then
    function_definition := replace(function_definition, ambiguous_reference, qualified_reference);
  elsif position('and existing.source_fingerprint = v_source_fingerprint' in function_definition) = 0
     and position(qualified_reference in function_definition) = 0 then
    raise exception 'The setup-import fingerprint condition was not found.';
  end if;

  execute function_definition;
end;
$$;
