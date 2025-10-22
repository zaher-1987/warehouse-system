// 📁 public/dashboard.js
let editMode = false;
let userRole = 'staff';
let assignedWarehouse = '';

// ✅ Session check
async function checkSession() {
  const res = await fetch('/session-status');
  const data = await res.json();
  if (!data.loggedIn) return (window.location.href = '/login.html');

  userRole = data.user.role;
  assignedWarehouse = data.user.warehouse_name || '';

  document.getElementById('userWarehouseInfo').textContent =
    userRole === 'admin'
      ? 'Logged in as Admin (all warehouses)'
      : `Logged in as ${userRole} - Warehouse: ${assignedWarehouse}`;

  const ticketsBtn = document.getElementById('viewTicketsBtn');
  if (userRole === 'production') {
    ticketsBtn.href = '/production-view.html';
  } else if (userRole === 'admin') {
    ticketsBtn.href = '/ticket-view.html';
    document.getElementById('editToggle').style.display = 'inline-block';
    document.getElementById('createWarehouseBtn').style.display = 'inline-block';
    document.getElementById('sendStockSection').style.display = 'block';
  }
  ticketsBtn.style.display = 'inline-block';

  await populateDropdowns();
  await loadInventory();
}

// ✅ Populate filter and target dropdowns
async function populateDropdowns() {
  const warehouseDropdown = document.getElementById('targetWarehouseDropdown');
  const filterDropdown = document.getElementById('warehouseFilter');
  const res = await fetch('/warehouses');
  const warehouses = await res.json();

  warehouseDropdown.innerHTML = '<option value="">Select warehouse</option>';
  filterDropdown.innerHTML = '<option value="">All</option>';

  warehouses.forEach(w => {
    if (w.name !== 'Main Warehouse') {
      warehouseDropdown.innerHTML += `<option value="${w.name}">${w.name}</option>`;
    }
    filterDropdown.innerHTML += `<option value="${w.name}">${w.name}</option>`;
  });
}

// ✅ Load filtered inventory
async function loadInventory() {
  const res = await fetch('/inventory-status');
  const data = await res.json();
  const tbody = document.querySelector('#inventoryTable tbody');
  const selectedWarehouse = document.getElementById('warehouseFilter').value;

  tbody.innerHTML = '';
  const filtered = selectedWarehouse
    ? data.filter(i => i.warehouse_name === selectedWarehouse)
    : data;

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    tr.classList.add(item.status || 'unknown');
    const statusIcon =
      item.status === 'green' ? '✅' :
      item.status === 'orange' ? '⚠️' :
      item.status === 'red' ? '❌' : '❓';
    tr.innerHTML = `
      <td>${item.warehouse_name}</td>
      <td>${item.item_id}</td>
      <td>${item.name}</td>
      <td class="${editMode ? 'edit-cell' : ''}" contenteditable="${editMode}">${item.quantity}</td>
      <td>${statusIcon}</td>`;
    tbody.appendChild(tr);
  });
}

// ✅ Edit mode toggle
function toggleEdit() {
  editMode = !editMode;
  document.getElementById('editToggle').textContent = editMode ? '💾 Disable Edit Mode' : '✏️ Enable Edit Mode';
  loadInventory();
  alert(editMode ? 'Edit mode enabled. You can now edit quantities.' : 'Edit mode disabled.');
}

// ✅ Create new warehouse
async function createWarehouse() {
  const name = document.getElementById('newWarehouseInput').value.trim();
  if (!name) return alert('❌ Enter warehouse name.');

  const res = await fetch('/add-warehouse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const result = await res.json();
  if (result.success) {
    alert('✅ Warehouse created.');
    document.getElementById('newWarehouseInput').value = '';
    document.getElementById('createWarehouseContainer').style.display = 'none';
    await populateDropdowns();
    await loadInventory();
  } else {
    alert('❌ ' + result.message);
  }
}

// ✅ Send stock
async function sendStock() {
  const targetWarehouse = document.getElementById('targetWarehouseDropdown').value;
  const item_id = document.getElementById('productDropdown').value;
  const quantity = parseInt(document.getElementById('stockQuantity').value);
  const request_date = document.getElementById('requestDate').value;
  const collect_date = document.getElementById('collectDate').value;

  if (!targetWarehouse || !item_id || !quantity || !request_date || !collect_date)
    return alert('❌ Fill all fields before sending stock.');

  const res = await fetch('/send-stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Main Warehouse', to: targetWarehouse, item_id, quantity, request_date, collect_date })
  });
  const result = await res.json();
  if (result.success) {
    alert('✅ Stock sent.');
    await loadInventory();
  } else {
    alert('❌ Failed: ' + result.message);
  }
}

// ✅ Utility actions
function exportInventory() {
  window.location.href = '/export-inventory';
}
function openChartModal() {
  document.getElementById('chartModal').style.display = 'block';
}
function closeChartModal() {
  document.getElementById('chartModal').style.display = 'none';
}

// ✅ Bind UI
window.addEventListener('DOMContentLoaded', () => {
  checkSession();

  document.getElementById('editToggle')?.addEventListener('click', toggleEdit);
  document.getElementById('createWarehouseBtn')?.addEventListener('click', () => {
    const div = document.getElementById('createWarehouseContainer');
    div.style.display = div.style.display === 'none' ? 'block' : 'none';
  });
  function saveEditedQuantities() {
  const rows = document.querySelectorAll('#inventoryTable tbody tr');
  const updates = [];

  rows.forEach(row => {
    const warehouse = row.children[0].textContent;
    const item_id = row.children[1].textContent;
    const quantity = row.children[3].textContent.trim();

    updates.push({ warehouse_name: warehouse, item_id, quantity });
  });

  fetch('/update-quantities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('✅ Inventory quantities saved successfully!');
        loadInventory(); // Refresh
      } else {
        alert('❌ Failed to save inventory.');
      }
    });
}
  document.getElementById('saveWarehouseBtn')?.addEventListener('click', createWarehouse);
  document.getElementById('warehouseFilter')?.addEventListener('change', loadInventory);
});

