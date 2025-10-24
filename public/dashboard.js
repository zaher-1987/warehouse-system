// ✅ Wix integration: SKU → warehouse mapping + stock deduction + auto-ticketing
import wixPaymentProviderBackend from 'wix-payment-provider-backend';
import { ok, badRequest } from 'wix-http-functions';
import wixSecretsBackend from 'wix-secrets-backend';
import { createClient, OAuthStrategy } from '@wix/sdk';
import { products } from '@wix/stores';
import { writeFile, readFile } from 'fs/promises';

const WAREHOUSE_JSON = 'data/warehouses.json';
const ITEMS_JSON = 'data/items.json';
const TICKETS_JSON = 'data/tickets.json';

const client = createClient({
  modules: { products },
  auth: OAuthStrategy({ clientId: 'c2ff93e9-a205-4993-a48c-b67bfa55fb1a' }),
});

async function readJson(file) {
  try {
    const data = await readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}
async function writeJson(file, data) {
  await writeFile(file, JSON.stringify(data, null, 2));
}

// ✅ Webhook for order sync
export async function post_orderWebhook(request) {
  try {
    const raw = await request.body.text();
    const order = JSON.parse(raw);
    console.log('🛒 Order webhook received:', order);

    const skus = [];
    order.lineItems?.forEach((item) => {
      if (item.sku && item.quantity) {
        skus.push({ sku: item.sku, qty: item.quantity });
      }
    });

    if (skus.length === 0) return ok({ msg: 'No SKUs to process' });

    const items = await readJson(ITEMS_JSON);
    const warehouses = await readJson(WAREHOUSE_JSON);
    const mainWarehouse = warehouses.find(w => w.name.toLowerCase().includes('main'));
    const tickets = await readJson(TICKETS_JSON);

    for (const { sku, qty } of skus) {
      const targetItem = items.find(i => i.item_id === sku && i.warehouse_id === 6); // India warehouse

      if (!targetItem) {
        // Auto-create if missing
        const mainItem = items.find(i => i.item_id === sku && i.warehouse_id === mainWarehouse?.id);
        if (mainItem) {
          items.push({
            item_id: sku,
            name: mainItem.name,
            quantity: 0,
            warehouse_id: 6
          });
        }
        continue;
      }

      // Deduct stock
      targetItem.quantity -= qty;
      if (targetItem.quantity < 0) targetItem.quantity = 0;

      // Auto-ticket if stock low
      const mainItem = items.find(i => i.item_id === sku && i.warehouse_id === mainWarehouse?.id);
      if (mainItem && mainItem.quantity > 0) {
        const percent = (targetItem.quantity / mainItem.quantity) * 100;
        if (percent <= 60) {
          const newTicket = {
            id: Date.now(),
            from_warehouse: mainWarehouse?.name,
            to_warehouse: 'India',
            item_id: sku,
            name: targetItem.name,
            quantity: Math.ceil(mainItem.quantity / 10),
            request_date: new Date().toISOString(),
            collect_date: '',
            status: 'Pending',
            expected_ready: '',
            actual_ready: '',
            delay_reason: '',
            updated_at: new Date().toISOString(),
            created_by: 'auto-wix-order'
          };
          tickets.push(newTicket);
          console.log('🎫 Auto-created ticket:', newTicket);
        }
      }
    }

    await writeJson(ITEMS_JSON, items);
    await writeJson(TICKETS_JSON, tickets);

    return ok({ success: true });
  } catch (err) {
    console.error('❌ Error processing order webhook:', err);
    return badRequest({ error: 'Webhook failed' });
  }
}

// 🛒 Get Wix products
export async function get_wix_products(request) {
  try {
    const result = await client.products.queryProducts().find();
    console.log('🧾 Wix products:', result.items);
    return ok({ products: result.items });
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    return badRequest({ error: 'Failed to fetch products' });
  }
}
