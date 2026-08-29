# Odoo 19 — Multi-Tenant B2B → B2C Store Platform

**Target structure**

```
Platform (super admin)
 └── B2B Tenant  (many)          → own company, own admin, own domain, own catalog
      ├── B2B storefront         (login-required, invite-only signup, tax-excluded)
      └── B2C storefront (many)  → own domain/subdomain, public signup, tax-included
```

Onboarding a new customer = one wizard that provisions company + B2B website + admin user
+ pricelist + sales team + domain, in one click.

Verified against `/odoo/odoo-19-community` @ 19.0 final.

---

## 1. What Odoo 19 already gives you (do not rebuild)

| Capability | Where | Notes |
|---|---|---|
| Multiple storefronts in one DB | `website` model, `addons/website/models/website.py` | `name`, `sequence`, `domain`, `company_id` (required) |
| Domain-based routing | `website._get_current_website_id()` (`website.py:1411`) | Exact netloc match on `website.domain`, ormcached, falls back to first website |
| Per-website company | `website.company_id` | Tenant boundary hook already exists |
| Per-website catalog | `product.template` inherits `website.published.multi.mixin` (`website_sale/models/product_template.py:35`) | `website_id` M2O: set = one site only, empty = all sites |
| Per-website pricelist | `product.pricelist.website_id` + constraint `company_id == website_id.company_id` (`website_sale/models/product_pricelist.py:42`) | |
| B2B vs B2C switch | `website.auth_signup_uninvited` (`b2b`/`b2c`), `website.ecommerce_access` (`everyone`/`logged_in`), `website.account_on_checkout` | `website_sale/models/website.py:88,238` — this *is* Odoo's native B2B mode |
| Tax display per site | `website.show_line_subtotals_tax_selection` (`tax_included`/`tax_excluded`) | |
| Per-website customer accounts | `res.users.website_id` (related, stored) + unique `(login, website_id)` (`website/models/res_users.py:14`) | Same email can exist as separate customer on two stores |
| Per-website salesperson/team | `website.salesperson_id`, `website.salesteam_id` | Orders auto-routed |
| Order/invoice tagging | `sale.order.website_id`, `account.move.website_id` | Reporting per store for free |
| Per-website pages/themes | `website.page`, `ir.ui.view` COW mechanism, `theme_models.py` | Each store can have its own design |
| Company hierarchy | `res.company.parent_id` / `child_ids` / `parent_path` / `root_id` (`base/models/res_company.py:36-41`) | Native tree, use it for tenant hierarchy |
| Multi-website UI toggle | `website.group_multi_website`, auto-implied when a 2nd website is created (`website.py:328`) | |

**Bottom line:** the *storefront* layer is done. What is missing is the *tenancy* layer.

---

## 2. Gaps — what is missing

### G1. No tenant concept — **critical**
`website` has `company_id` but no parent/child link. Nothing expresses "these 4 B2C stores
belong to B2B tenant X". No model holds tenant-level state (plan, status, quota, owner).

### G2. Zero isolation between website admins — **critical, security**
`addons/website/security/ir.model.access.csv:5` grants `group_website_designer` full
CRUD (1,1,1,1) on `model_website`. There is **no `ir.rule` scoping `website` by company**.
Consequence today: any B2B admin you create can read, edit, and delete every other
tenant's website record, pages, and views. Same for `website.menu`, `website.page`,
`ir.ui.view`, `product.public.category`.
This is the single biggest blocker — everything else is plumbing.

### G3. Catalog sharing model too narrow — **high**
`product.template.website_id` is a single M2O. A product is either on exactly one website
or on all of them. A B2B tenant that wants one catalog shared across its own B2B site + its
3 B2C sites (but invisible to other tenants) cannot be expressed with that field alone.

### G4. No provisioning flow — **high**
Creating a store today is ~12 manual steps across Settings, Companies, Users, Pricelists,
Websites, Sales Teams. No wizard, no template/clone, no defaults, no rollback.

### G5. No cross-store admin dashboard — **high**
No consolidated view of stores (GMV, orders, carts, status, plan, domain health). Odoo's
sales dashboards are per-company/per-user, not per-store-tenant.

### G6. B2B admin has no scoped back office — **high**
Odoo backend menus are global. A tenant admin logged into `/odoo` sees every app the
groups allow, plus other companies in the company switcher if `company_ids` is mis-set.
Also: every tenant admin is an *internal* user (license cost on Enterprise/Odoo.sh).

### G7. Domain routing has no wildcard support — **medium**
`_get_current_website_id` does an exact match on `website.domain` only. Subdomain-per-store
works, but each store must have `domain` filled in, plus wildcard DNS + wildcard TLS at the
reverse proxy. No automatic `<slug>.platform.com` derivation, no uniqueness constraint on
`domain`, no auto-fill on creation.

### G8. No tenant lifecycle — **medium**
No suspend / archive / delete-with-data / plan limits / quota (max B2C stores per B2B,
max products). `website.active` exists but nothing cascades to its children.

### G9. No tenant billing — **medium**
`sale_subscription` is Enterprise-only. Community has nothing to recurring-bill a B2B tenant
for the platform itself.

### G10. Shared globals leak across tenants — **medium**
Payment providers, delivery carriers, mail servers, product attributes, UoM, and
`ir.attachment` for website assets are largely company-shared or global. Payment providers
are company-scoped (fine); attributes and public categories are not website-scoped by
default and will bleed between tenants.

---

## 3. Recommended architecture

**One database. Tenant = `res.company`. Store = `website`.**

```
res.company (platform)
 └── res.company (tenant "ACME")        ← the B2B tenant boundary
      ├── website  ACME B2B   (parent, kind=b2b)
      ├── website  ACME Shop  (kind=b2c, parent_store_id=ACME B2B)
      └── website  ACME Outlet(kind=b2c, parent_store_id=ACME B2B)
```

Why: `company_id` already exists on `website`, `product.pricelist`, `sale.order`,
`account.move`, `product.template`, `res.users.company_ids` — Odoo's whole multi-company
record-rule machinery becomes your isolation layer for free. Adding a parallel `tenant_id`
to 40 models would be the same result with 10x the code.

Rejected alternatives (one line each):
- *DB per tenant (odoo-saas style):* real isolation, but you own DB provisioning, upgrades,
  backups, and cross-tenant reporting becomes impossible. Only worth it above ~200 tenants
  or on a hard data-residency requirement.
- *Single company, websites only:* no isolation primitives at all — you would hand-write
  record rules for every model.

---

## 4. The module: `multi_store`

One custom module. Depends: `website_sale`, `sale_management`, `contacts`.

### 4.1 Models

**`res.company`** (extend) — nothing new needed; `parent_id` already gives the tree.

**`website`** (extend)
```python
store_kind      = Selection([('b2b','B2B'),('b2c','B2C')], required=True, default='b2c')
parent_store_id = Many2one('website', domain="[('store_kind','=','b2b')]", ondelete='cascade')
child_store_ids = One2many('website', 'parent_store_id')
slug            = Char(required=True)          # SQL unique
owner_user_id   = Many2one('res.users')        # tenant admin
state           = Selection([('draft','Draft'),('live','Live'),('suspended','Suspended')])
```
Constraints: `parent_store_id.company_id == company_id`; B2B cannot have a parent;
B2C must have one; `domain` unique (SQL); `slug` unique.

`domain` auto-computed as `https://{slug}.{platform_base}` unless overridden.

**`store.plan`** (new, small) — `max_b2c_stores`, `max_products`, `price`. Enforced in
`create()` of `website`. Skip entirely if you don't plan to sell tiers.

### 4.2 Security — this is the actual work (fixes G2)

Groups:
- `group_store_admin` — tenant admin, sees only own company's stores.
- `group_platform_admin` — super admin, sees all (implies `group_store_admin` +
  `website.group_multi_website` + `base.group_multi_company`).

Record rules, `groups="multi_store.group_store_admin"`, all with
`domain_force = [('company_id','in',company_ids)]`:
`website`, `website.page`, `website.menu`, `product.pricelist`, `product.template`,
`sale.order`, `account.move`, `res.partner`, `crm.team`, `product.public.category`,
`product.feed`, `payment.provider`, `delivery.carrier`.

Plus `ir.ui.view` — the nasty one: views are website-scoped by COW but not company-scoped.
Rule: `['|',('website_id','=',False),('website_id.company_id','in',company_ids)]` with
write/unlink denied on `website_id = False` for store admins (otherwise a tenant editing a
global template breaks every other tenant).

Tenant admin users get `company_ids = [tenant_company]`, `company_id = tenant_company`.

**Acceptance test for this phase (non-negotiable):** log in as tenant A's admin, attempt
read/write/unlink on tenant B's `website`, `website.page`, `ir.ui.view`, `sale.order`,
`product.template`, `res.partner` → all must raise `AccessError`. Write it as a real
`TransactionCase`; this is the one thing you cannot ship untested.

### 4.3 Catalog scoping (fixes G3)

Two options, pick per business rule:

- **A (lazy, recommended):** products are company-owned (`product.template.company_id =
  tenant company`), `website_id` left empty. Company record rules isolate tenants; empty
  `website_id` means "all of *my* stores". Shared platform catalog = products on the
  platform company with `company_id = False`.
- **B:** add `website_ids` M2M and override `_search`/`website_domain` to honour it. Only
  needed if a tenant wants product X on 2 of its 4 stores. Add when a customer asks.

### 4.4 Provisioning wizard (fixes G4)

`store.provision.wizard` — `TransientModel`, fields: customer name, slug, admin email,
plan, country/currency, template store (optional).

`action_provision()` in one transaction:
1. `res.company` (child of platform) — currency, country, chart of accounts.
2. `res.users` — tenant admin, `groups = [group_store_admin, sale.group_sale_salesman,
   website.group_website_designer]`, `company_ids = [new company]`, `signup` invite mail.
3. `website` B2B — `store_kind='b2b'`, `auth_signup_uninvited='b2b'`,
   `ecommerce_access='logged_in'`, `show_line_subtotals_tax_selection='tax_excluded'`,
   `account_on_checkout='mandatory'`.
4. `crm.team` + link as `website.salesteam_id`.
5. `product.pricelist` scoped to that website/company.
6. Optional: copy pages/theme from a template website.

A second, smaller wizard `store.b2c.wizard` runs on a B2B website → creates a B2C child:
`auth_signup_uninvited='b2c'`, `ecommerce_access='everyone'`,
`show_line_subtotals_tax_selection='tax_included'`, same company, `parent_store_id` set,
plan quota checked. This is the button the *tenant admin* uses.

### 4.5 Admin dashboards (fixes G5)

- **Platform dashboard:** list/kanban on `website` with computed `order_count`,
  `revenue_30d`, `cart_count`, `state`, `domain`, grouped by company. Computes via
  `read_group` on `sale.order` filtered by `website_id` — no new model, no SQL view.
  Add a `store.dashboard` SQL view only if the kanban gets slow (>200 stores).
- **Tenant dashboard:** same views, record rules do the filtering. Zero extra code.

### 4.6 Tenant back office (fixes G6)

Ship a trimmed menu root `Stores` with: My Stores, Products, Orders, Customers,
Pricelists, Website Editor. Hide Settings/Apps/Accounting via groups.
Tenant admins are internal users — **budget for the license cost** if you're on
Enterprise/Odoo.sh. If that's a dealbreaker, the alternative is a portal-based custom admin
(controllers under `/store/admin` for portal users). That is roughly 3x the work of the
backend approach; only take it if licensing forces you.

---

## 5. Infrastructure (fixes G7)

- Wildcard DNS `*.platform.com → server`.
- Wildcard TLS cert (Let's Encrypt DNS-01) or per-domain certs via Caddy/`certbot` on-demand.
- Nginx/Caddy passes `Host` through — Odoo already resolves the website from it.
- Set `web.base.url` per company; leave `web.base.url_freeze = True` so Odoo stops
  rewriting it on every admin login.
- Custom domains: tenant sets a CNAME → you add the domain on `website.domain` + issue a
  cert. Automate with Caddy on-demand TLS with an `ask` endpoint that validates the host
  against `website.domain` (a 5-line Odoo controller).
- `ormcache` on `_get_current_website_id` — call `website.clear_caches()` after changing a
  domain, or new domains won't resolve until restart. Easy to miss.

---

## 6. Phases

| Phase | Scope | Ships when |
|---|---|---|
| **0 — Spike (1–2d)** | Manually create 2 companies, 3 websites, 2 admins in a scratch DB. Confirm isolation holes are exactly G2. | You've seen tenant A edit tenant B's page |
| **1 — Isolation (5–8d)** | `multi_store` module skeleton, groups, all record rules, `ir.ui.view` rule, cross-tenant `AccessError` test suite | Isolation tests green |
| **2 — Hierarchy (3–4d)** | `website` extension fields + constraints, slug/domain auto-compute, cache invalidation | B2B→B2C tree visible and enforced |
| **3 — Provisioning (4–6d)** | Both wizards, invite mail, rollback on failure, quota check | New customer live in one click |
| **4 — Dashboards (3–5d)** | Platform + tenant kanban/list, KPIs, menus, trimmed tenant back office | Super admin sees all stores with GMV |
| **5 — Infra (2–4d)** | Wildcard DNS/TLS, on-demand cert endpoint, staging deploy | `acme.platform.com` and `shop.acme.com` both resolve |
| **6 — Lifecycle (3–5d)** | Suspend/resume cascade, archive, data export per tenant | Suspending B2B takes its B2C stores offline |
| **7 — Billing (optional)** | Tenant invoicing; Enterprise `sale_subscription`, or Stripe Billing + webhook | Only if you charge tenants |

Rough total: **4–6 weeks** for one developer, phases 1–6.

---

## 7. Risks

1. **Record-rule gaps.** Every module you install later (helpdesk, blog, forum, events)
   adds models with no tenant rule. Keep a checklist; re-run the isolation test suite after
   every module install. This is ongoing cost, not one-time.
2. **`ir.ui.view` / COW.** Website editing writes to views. A tenant admin with
   `group_website_designer` who touches a non-website-scoped view breaks all tenants.
   Rule this out in phase 1 and test it explicitly.
3. **`ormcache` on domain lookup.** Stale cache = new store 404s. Invalidate on write.
4. **Odoo major upgrades.** Custom record rules and `website` overrides are the parts that
   break on 20.0. Keep the module thin; prefer configuration over override.
5. **Shared assets/attachments.** `ir.attachment` for website images is loosely scoped —
   audit before go-live that tenant A cannot enumerate tenant B's uploads via `/web/image`.
6. **Scale.** One DB holds everyone. Plan the exit to DB-per-tenant before you're at
   200+ tenants; keep provisioning logic in one place so it can be retargeted.

---

## 8. Decisions needed from you

1. Do B2C stores under one B2B share a single catalog, or need per-store product selection?
   (Picks §4.3 option A vs B.)
2. Tenant admins as internal users (license cost, fast) or portal-based custom admin
   (free, 3x work)?
3. Custom domains per store from day one, or subdomains only for v1?
4. Do you bill tenants inside Odoo (phase 7) or externally?
5. Community or Enterprise? Enterprise gives `sale_subscription` + studio; Community means
   phase 7 is Stripe + a webhook controller.
