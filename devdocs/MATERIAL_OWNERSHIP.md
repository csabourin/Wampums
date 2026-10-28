# Material and ownership

`/material` is the single equipment destination. **En stock / In stock** opens first;
**Tous les articles / All articles** also includes articles used in activity lists
that have no physical stock. The former `/inventory` and `/equipment-catalog`
links redirect to their tabs. A linked article and its stock appear once in All articles.
An article can enable stock in the same save. Article creation, stock creation and
their link are one transaction; a failure rolls everything back. This action needs
both `equipment_catalog.manage` and `inventory.manage`. Updating linked article
metadata synchronizes the managing unit's physical record without changing quantities.

`equipment_items.organization_id` identifies the unit maintaining the record.
It does **not** establish who owns the physical equipment. Migration 060 adds:

| Owner | Stored fields | Who can use the item |
| --- | --- | --- |
| Unit | `owner_type = 'unit'`, no group ID | The managing unit and units it shares with |
| Scout group | `owner_type = 'group'`, `owner_local_group_id` | Units affiliated with that exact Scout group |
| Unspecified historic record | Both new fields null | Existing access rules remain until ownership is specified |

Existing items stay unspecified. Correcting the owner updates the same physical
item ID, preserving quantities, reservations, loans and linked articles. Only the
record's managing unit may change ownership, and it may select only a Scout group
it belongs to. Group ownership automatically makes the same item available to the
member units; it never copies quantities or relies on the old sharing flag.
Membership in another group of the maintaining unit, or a stale explicit share,
does not grant access to a group-owned item. Reservations and loans apply the same
central access rule as the stock listing.

`GET /api/v1/resources/equipment/owners` returns only associated Scout group IDs
and names for an authorized stock manager. No group roster is loaded.
