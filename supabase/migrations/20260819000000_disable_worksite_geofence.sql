-- A batida de ponto nao depende mais da localizacao do dispositivo.
-- O valor global mantem compatibilidade com versoes antigas da API que ainda
-- leem a coluna, sem apagar as coordenadas historicas das obras.
alter table public.worksites
  alter column geofence_radius_meters set default 40100000;

update public.worksites
set geofence_radius_meters = 40100000
where geofence_radius_meters < 40100000;

