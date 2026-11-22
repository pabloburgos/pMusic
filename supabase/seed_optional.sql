-- =============================================================================
-- pMusic — Semillas opcionales de afinidad para escena urbana española
-- Ejecuta esta función después de iniciar sesión si quieres precargar tus
-- artistas semilla directamente en PostgreSQL (la app ya los precarga en local).
-- =============================================================================

create or replace function public.pmusic_seed_spanish_urban_artists(target_user_id uuid default auth.uid())
returns void
language plpgsql
security definer
as $$
begin
  if target_user_id is null then
    raise exception 'Se requiere un user_id autenticado para insertar semillas';
  end if;

  insert into public.artist_affinity (user_id, artist_key, artist_name, score, genres, is_seed)
  values
    (target_user_id, 'bad bunny', 'Bad Bunny', 8.0, array['reggaeton', 'trap_latino', 'urbano'], true),
    (target_user_id, 'la pantera', 'La Pantera', 8.0, array['trap_canarias', 'urbano_es', 'reggaeton'], true),
    (target_user_id, 'cruz cafune', 'Cruz Cafuné', 8.0, array['urbano_es', 'trap_canarias', 'hip_hop_es'], true),
    (target_user_id, 'quevedo', 'Quevedo', 4.5, array['urbano_es', 'trap_canarias', 'reggaeton'], true),
    (target_user_id, 'saiko', 'Saiko', 4.5, array['urbano_es', 'reggaeton', 'pop_urbano_es'], true),
    (target_user_id, 'morad', 'Morad', 4.5, array['drill_es', 'urbano_es', 'mdlr'], true),
    (target_user_id, 'dellafuente', 'Dellafuente', 4.5, array['flamenco_urbano', 'urbano_es'], true),
    (target_user_id, 'rels b', 'Rels B', 4.5, array['rnb_es', 'urbano_es'], true)
  on conflict (user_id, artist_key) do update
    set score = greatest(public.artist_affinity.score, excluded.score),
        is_seed = true,
        updated_at = timezone('utc', now());
end;
$$;
