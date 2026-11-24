-- MIKUY MINI-ERP | Esquema inicial para Supabase (PostgreSQL)
-- Ejecutar completo en Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default 'Usuario Mikuy',
  rol text not null default 'mesero' check (rol in ('administrador','mesero','cocina')),
  created_at timestamptz not null default now()
);

create table if not exists public.mesas (
  id uuid primary key default gen_random_uuid(),
  numero integer not null unique check (numero between 1 and 16),
  capacidad integer not null default 4 check (capacidad > 0),
  estado text not null default 'disponible' check (estado in ('disponible','ocupada','reservada')),
  created_at timestamptz not null default now()
);

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid references public.categorias(id),
  nombre text not null unique,
  descripcion text,
  precio numeric(10,2) not null check (precio >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ingredientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  categoria text,
  unidad text not null default 'kg',
  stock_actual numeric(12,3) not null default 0 check (stock_actual >= 0),
  stock_minimo numeric(12,3) not null default 0 check (stock_minimo >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.recetas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  ingrediente_id uuid not null references public.ingredientes(id),
  cantidad numeric(12,3) not null check (cantidad > 0),
  unique(producto_id, ingrediente_id)
);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas(id),
  usuario_id uuid references public.usuarios(id),
  estado text not null default 'pendiente' check (estado in ('pendiente','preparando','preparado','entregado','cancelado')),
  subtotal numeric(10,2) not null default 0,
  igv numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  inventario_descontado boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.detalle_pedidos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null check (precio_unitario >= 0),
  observacion text
);

create table if not exists public.movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid not null references public.ingredientes(id),
  tipo text not null check (tipo in ('entrada','salida','ajuste')),
  cantidad numeric(12,3) not null check (cantidad > 0),
  observacion text,
  pedido_id uuid references public.pedidos(id),
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

-- Perfil automático para cada usuario que se registra en Auth.
create or replace function public.crear_perfil_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios(id,nombre,rol)
  values(new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)), 'mesero')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_mikuy on auth.users;
create trigger on_auth_user_created_mikuy after insert on auth.users
for each row execute procedure public.crear_perfil_usuario();

-- Registrar un pedido y actualizar la mesa en una sola transacción.
create or replace function public.registrar_pedido(p_mesa_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_pedido_id uuid;
  v_subtotal numeric(10,2) := 0;
  v_item jsonb;
  v_producto public.productos%rowtype;
  v_cantidad integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe contener al menos un producto.';
  end if;
  perform 1 from public.mesas where id=p_mesa_id and estado='disponible' for update;
  if not found then raise exception 'La mesa no está disponible.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cantidad := (v_item->>'cantidad')::integer;
    if v_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero.'; end if;
    select * into v_producto from public.productos where id=(v_item->>'producto_id')::uuid and activo=true;
    if not found then raise exception 'Uno de los productos no existe o está inactivo.'; end if;
    v_subtotal := v_subtotal + v_producto.precio * v_cantidad;
  end loop;

  insert into public.pedidos(mesa_id,usuario_id,subtotal,igv,total)
  values(p_mesa_id,auth.uid(),v_subtotal,round(v_subtotal*0.18,2),round(v_subtotal*1.18,2))
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_producto from public.productos where id=(v_item->>'producto_id')::uuid;
    insert into public.detalle_pedidos(pedido_id,producto_id,cantidad,precio_unitario)
    values(v_pedido_id,v_producto.id,(v_item->>'cantidad')::integer,v_producto.precio);
  end loop;
  update public.mesas set estado='ocupada' where id=p_mesa_id;
  return v_pedido_id;
end; $$;

-- Actualizar los productos y cantidades de un pedido pendiente.
create or replace function public.actualizar_pedido(p_pedido_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pedido public.pedidos%rowtype;
  v_item jsonb;
  v_producto public.productos%rowtype;
  v_cantidad integer;
  v_subtotal numeric(10,2) := 0;
begin
  select * into v_pedido from public.pedidos where id=p_pedido_id for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if v_pedido.estado <> 'pendiente' or v_pedido.inventario_descontado then
    raise exception 'Solo se pueden editar pedidos pendientes.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'El pedido debe contener al menos un producto.';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cantidad := (v_item->>'cantidad')::integer;
    if v_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero.'; end if;
    select * into v_producto from public.productos where id=(v_item->>'producto_id')::uuid and activo=true;
    if not found then raise exception 'Producto inexistente o inactivo.'; end if;
    v_subtotal := v_subtotal + v_producto.precio*v_cantidad;
  end loop;
  delete from public.detalle_pedidos where pedido_id=p_pedido_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_producto from public.productos where id=(v_item->>'producto_id')::uuid;
    insert into public.detalle_pedidos(pedido_id,producto_id,cantidad,precio_unitario)
    values(p_pedido_id,v_producto.id,(v_item->>'cantidad')::integer,v_producto.precio);
  end loop;
  update public.pedidos set subtotal=v_subtotal,igv=round(v_subtotal*0.18,2),total=round(v_subtotal*1.18,2)
  where id=p_pedido_id;
end; $$;

-- Descontar los ingredientes una sola vez al marcar un pedido como preparado.
create or replace function public.preparar_pedido(p_pedido_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pedido public.pedidos%rowtype;
  v_detalle record;
  v_receta record;
begin
  select * into v_pedido from public.pedidos where id=p_pedido_id for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if v_pedido.inventario_descontado then
    update public.pedidos set estado='preparado' where id=p_pedido_id;
    return;
  end if;
  if v_pedido.estado not in ('pendiente','preparando') then
    raise exception 'El pedido no se encuentra en un estado válido para preparación.';
  end if;

  for v_detalle in
    select dp.producto_id,dp.cantidad from public.detalle_pedidos dp where dp.pedido_id=p_pedido_id
  loop
    for v_receta in
      select r.ingrediente_id,r.cantidad,i.nombre,i.unidad,i.stock_actual
      from public.recetas r join public.ingredientes i on i.id=r.ingrediente_id
      where r.producto_id=v_detalle.producto_id
      for update of i
    loop
      if v_receta.stock_actual < v_receta.cantidad*v_detalle.cantidad then
        raise exception 'Stock insuficiente de %: disponible % %, requerido % %.',
          v_receta.nombre,v_receta.stock_actual,v_receta.unidad,
          v_receta.cantidad*v_detalle.cantidad,v_receta.unidad;
      end if;
      update public.ingredientes
      set stock_actual=stock_actual-(v_receta.cantidad*v_detalle.cantidad)
      where id=v_receta.ingrediente_id;
      insert into public.movimientos_inventario(ingrediente_id,tipo,cantidad,observacion,pedido_id,usuario_id)
      values(v_receta.ingrediente_id,'salida',v_receta.cantidad*v_detalle.cantidad,
        'Consumo por preparación del pedido',p_pedido_id,auth.uid());
    end loop;
  end loop;
  update public.pedidos set estado='preparado',inventario_descontado=true where id=p_pedido_id;
end; $$;

create or replace function public.registrar_entrada_inventario(
  p_ingrediente_id uuid,p_cantidad numeric,p_observacion text default 'Ingreso manual'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor a cero.'; end if;
  update public.ingredientes set stock_actual=stock_actual+p_cantidad where id=p_ingrediente_id;
  if not found then raise exception 'Ingrediente no encontrado.'; end if;
  insert into public.movimientos_inventario(ingrediente_id,tipo,cantidad,observacion,usuario_id)
  values(p_ingrediente_id,'entrada',p_cantidad,p_observacion,auth.uid());
end; $$;

-- Seguridad: RLS habilitado. Los usuarios autenticados pueden operar el sistema.
alter table public.usuarios enable row level security;
alter table public.mesas enable row level security;
alter table public.categorias enable row level security;
alter table public.productos enable row level security;
alter table public.ingredientes enable row level security;
alter table public.recetas enable row level security;
alter table public.pedidos enable row level security;
alter table public.detalle_pedidos enable row level security;
alter table public.movimientos_inventario enable row level security;

do $$ declare t text; begin
  foreach t in array array['usuarios','mesas','categorias','productos','ingredientes','recetas','pedidos','detalle_pedidos','movimientos_inventario'] loop
    execute format('drop policy if exists "Acceso autenticado %1$s" on public.%1$s',t);
    execute format('create policy "Acceso autenticado %1$s" on public.%1$s for all to authenticated using (true) with check (true)',t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on function public.registrar_pedido(uuid,jsonb) to authenticated;
grant execute on function public.preparar_pedido(uuid) to authenticated;
grant execute on function public.actualizar_pedido(uuid,jsonb) to authenticated;
grant execute on function public.registrar_entrada_inventario(uuid,numeric,text) to authenticated;

-- Datos iniciales: 16 mesas, categorías, menú, ingredientes y recetas demostrativas.
insert into public.mesas(numero,capacidad) values
(1,2),(2,2),(3,4),(4,4),(5,4),(6,4),(7,4),(8,4),
(9,4),(10,4),(11,4),(12,4),(13,6),(14,6),(15,6),(16,6)
on conflict (numero) do nothing;

insert into public.categorias(nombre) values
('Entradas'),('Fondos'),('Bebidas'),('Postres')
on conflict (nombre) do nothing;

insert into public.productos(categoria_id,nombre,descripcion,precio)
select c.id,x.nombre,x.descripcion,x.precio
from (values
('Entradas','Papa a la huancaína','Papa sancochada con crema huancaína.',16.00),
('Entradas','Causa limeña','Causa de papa amarilla con relleno de pollo.',18.00),
('Fondos','Lomo saltado','Lomo de res salteado con cebolla, tomate y papas.',32.00),
('Fondos','Ají de gallina','Guiso tradicional de gallina con ají amarillo.',28.00),
('Fondos','Arroz con pollo','Arroz verde con presa de pollo.',26.00),
('Fondos','Tallarines verdes con bistec','Tallarines en salsa de albahaca con bistec.',30.00),
('Bebidas','Limonada','Limonada clásica de la casa.',9.00),
('Bebidas','Chicha morada','Bebida tradicional de maíz morado.',8.00),
('Bebidas','Maracuyá','Refresco natural de maracuyá.',8.00),
('Postres','Arroz con leche','Postre tradicional peruano.',10.00)
) as x(categoria,nombre,descripcion,precio)
join public.categorias c on c.nombre=x.categoria
on conflict (nombre) do nothing;

insert into public.ingredientes(nombre,categoria,unidad,stock_actual,stock_minimo) values
('Carne de res','Carnes','kg',8,2),('Papa','Verduras','kg',15,4),
('Cebolla','Verduras','kg',6,2),('Tomate','Verduras','kg',5,1.5),
('Arroz','Abarrotes','kg',20,5),('Pollo','Carnes','kg',10,3),
('Ají amarillo','Verduras','kg',3,1),('Limón','Frutas','kg',5,1.5),
('Azúcar','Abarrotes','kg',8,2),('Maíz morado','Abarrotes','kg',4,1)
on conflict (nombre) do nothing;

-- Recetas con unidades homogéneas por kg/litro. Cantidades por plato.
insert into public.recetas(producto_id,ingrediente_id,cantidad)
select p.id,i.id,x.cantidad
from (values
('Lomo saltado','Carne de res',0.20),('Lomo saltado','Papa',0.15),
('Lomo saltado','Cebolla',0.10),('Lomo saltado','Tomate',0.08),
('Lomo saltado','Arroz',0.15),('Ají de gallina','Pollo',0.18),
('Ají de gallina','Ají amarillo',0.04),('Ají de gallina','Arroz',0.15),
('Arroz con pollo','Pollo',0.20),('Arroz con pollo','Arroz',0.18),
('Limonada','Limón',0.12),('Limonada','Azúcar',0.03),
('Chicha morada','Maíz morado',0.08),('Chicha morada','Azúcar',0.03)
) as x(producto,ingrediente,cantidad)
join public.productos p on p.nombre=x.producto
join public.ingredientes i on i.nombre=x.ingrediente
on conflict (producto_id,ingrediente_id) do nothing;

-- Para dar permisos de administrador al primer usuario:
-- update public.usuarios set rol='administrador', nombre='Administrador Mikuy'
-- where id=(select id from auth.users order by created_at asc limit 1);
