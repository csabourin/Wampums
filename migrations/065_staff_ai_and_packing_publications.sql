-- AI is staff-only, independently of the feature's own management rights.
SELECT setval(pg_get_serial_sequence('public.permissions','id'),COALESCE((SELECT MAX(id) FROM public.permissions),0)+1,false);
INSERT INTO public.permissions (permission_key,permission_name,category,description)
VALUES ('ai.use','Use artificial intelligence','ai','Allow staff to explicitly generate or translate common content with AI')
ON CONFLICT (permission_key) DO NOTHING;
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT DISTINCT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.permission_key='ai.use' AND r.data_scope='organization' AND EXISTS (
 SELECT 1 FROM public.role_permissions rp JOIN public.permissions feature ON feature.id=rp.permission_id
 WHERE rp.role_id=r.id AND feature.permission_key IN ('communications.send','meetings.manage','activities.create','activities.edit','finance.manage','inventory.reserve','personal_equipment.manage')
) ON CONFLICT DO NOTHING;
-- Preparing activity content is an animation responsibility.
INSERT INTO public.role_permissions (role_id,permission_id)
SELECT DISTINCT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.data_scope='organization' AND p.permission_key IN ('personal_equipment.view','personal_equipment.manage','ai.use')
AND EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions feature ON feature.id=rp.permission_id
 WHERE rp.role_id=r.id AND feature.permission_key IN ('meetings.manage','activities.edit'))
ON CONFLICT DO NOTHING;
-- A draft edit never replaces the last content explicitly published to families.
CREATE TABLE IF NOT EXISTS public.packing_list_publications (
 organization_id INTEGER NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 resource_key TEXT NOT NULL,
 content JSONB NOT NULL,
 PRIMARY KEY (organization_id,resource_key)
);
INSERT INTO public.packing_list_publications (organization_id,resource_key,content)
SELECT l.organization_id,l.meeting_id::text,jsonb_build_object('list',to_jsonb(l)||jsonb_build_object('items',
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('key',i.item_key,'label_fr',i.label_fr,'label_en',i.label_en,'quantity',i.quantity,'catalog_item_id',i.catalog_item_id) ORDER BY i.position),'[]'::jsonb)
 FROM public.personal_equipment_items i WHERE i.organization_id=l.organization_id AND i.meeting_id=l.meeting_id AND i.active)),
 'translations',COALESCE((SELECT jsonb_object_agg(t.language,t.content) FROM public.personal_equipment_translations t
 WHERE t.organization_id=l.organization_id AND t.meeting_id=l.meeting_id AND t.version=l.version),'{}'::jsonb))
FROM public.personal_equipment_lists l WHERE l.published ON CONFLICT DO NOTHING;
INSERT INTO public.packing_list_publications (organization_id,resource_key,content)
SELECT l.organization_id,'activity-'||l.activity_id,jsonb_build_object('list',l.content||jsonb_build_object('version',l.version),
 'translations',COALESCE((SELECT jsonb_object_agg(t.language,t.content) FROM public.activity_personal_equipment_translations t
 WHERE t.organization_id=l.organization_id AND t.activity_id=l.activity_id AND t.version=l.version),'{}'::jsonb))
FROM public.activity_personal_equipment_lists l WHERE l.content->>'published'='true' ON CONFLICT DO NOTHING;
