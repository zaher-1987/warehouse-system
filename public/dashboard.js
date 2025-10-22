// ✅ dashboard.js — controls dashboard.html interactivity
let editMode = false;
let userRole = 'staff';
let assignedWarehouse = '';

// ✅ Check user session and show relevant UI
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

  if (userRole === 'production') {
    document.getElementById('viewTicketsBtn').href = '/production-view.html';
    document.getElementById('viewTicketsBtn').style.display = 'inline-block';
  } else if (userRole === 'admin') {
    document.getElementById('viewTicketsBtn').href = '/ticket-view.html';
    document.getElementById('viewTicketsBtn').style.display = 'inline-block';
    document.getElementById('editToggle').style.display = 'inline-block';
    document.getElementById('createWarehouseBtn').style.display = 'inline-block';
    document.getElementById('sendStockSection').style.display = 'block';
    populateDropdowns();
  }

  populateWarehouseFilter();
  loadInventory();
}

// ✅ Load inventory and apply warehouse filter
async function loadInventory() {
  const res = await fetch('/inventory-status');
  const data = await res.json();
  const tbody = document.querySelector('#inventoryTable tbody');
  const selectedWarehouse = document.getElementById('warehouseFilter').value;
  tbody.innerHTML = '';

  const filteredItems = selectedWarehouse
    ? data.filter(item => item.warehouse_name === selectedWarehouse)
    : data;

  filteredItems.forEach(item => {
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
      <td>${statusIcon}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ✅ Populate filter dropdown
async function populateWarehouseFilter() {
  const res = await fetch('/warehouses');
  const warehouses = await res.json();
  const filterDropdown = document.getElementById('warehouseFilter');
  filterDropdown.innerHTML = '<option value="">All</option>';
  warehouses.forEach(w => {
    const option = document.createElement('option');
    option.value = w.name;
    option.textContent = w.name;
    filterDropdown.appendChild(option);
  });
}

// ✅ Create warehouse dropdowns
async function populateDropdowns() {
  const warehouseDropdown = document.getElementById('targetWarehouseDropdown');
  const res = await fetch('/warehouses');
  const warehouses = await res.json();
  warehouseDropdown.innerHTML = '<option value="">Select warehouse</option>';
  warehouses.forEach(w => {
    if (w.name !== 'Main Warehouse') {
      const option = document.createElement('option');
      option.value = w.name;
      option.textContent = w.name;
      warehouseDropdown.appendChild(option);
    }
  });
}

// ✅ Enable Edit Mode
function toggleEditMode() {
  editMode = !editMode;
  document.getElementById('editToggle').textContent = editMode ? '💾 Disable Edit Mode' : '✏️ Enable Edit Mode';
  loadInventory();
  alert(editMode ? 'Edit mode enabled. You can now edit quantities.' : 'Edit mode disabled.');
}

// ✅ Send stock to another warehouse
async function sendStock() {
  const targetWarehouse = document.getElementById('targetWarehouseDropdown').value;
  const item_id = document.getElementById('productDropdown').value;
  const quantity = parseInt(document.getElementById('stockQuantity').value.trim());
  const request_date = document.getElementById('requestDate').value;
  const collect_date = document.getElementById('collectDate').value;

  if (!targetWarehouse || !item_id || !quantity || !request_date || !collect_date)
    return alert('❌ Please fill all fields before sending stock.');

  const payload = {
    from: 'Main Warehouse',
    to: targetWarehouse,
    item_id,
    quantity,
    request_date,
    collect_date
  };

  const res = await fetch('/send-stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await res.json();

  if (result.success) {
    alert('✅ Stock sent successfully!');
    loadInventory();
  } else {
    alert('❌ Failed to send stock: ' + result.message);
  }
}

// ✅ Create warehouse toggle
function toggleWarehouseForm() {
  const container = document.getElementById('createWarehouseContainer');
  container.style.display = container.style.display === 'none' ? 'block' : 'none';
}

// ✅ Save warehouse
async function saveWarehouse() {
  const name = document.getElementById('newWarehouseInput').value.trim();
  if (!name) return alert('❌ Please enter a warehouse name.');

  const res = await fetch('/add-warehouse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  const result = await res.json();
  if (result.success) {
    alert('✅ Warehouse created successfully!');
    document.getElementById('newWarehouseInput').value = '';
    document.getElementById('createWarehouseContainer').style.display = 'none';
    populateDropdowns();
    populateWarehouseFilter();
    loadInventory();
  } else {
    alert('❌ ' + result.message);
  }
}

// ✅ Export to Excel
function exportInventory() { window.location.href = '/export-inventory'; }
function openChartModal() { document.getElementById('chartModal').style.display = 'block'; }
function closeChartModal() { document.getElementById('chartModal').style.display = 'none'; }

// ✅ Add Event Listeners
document.getElementById('editToggle')?.addEventListener('click', toggleEditMode);
document.getElementById('createWarehouseBtn')?.addEventListener('click', toggleWarehouseForm);
document.getElementById('saveWarehouseBtn')?.addEventListener('click', saveWarehouse);
document.getElementById('warehouseFilter')?.addEventListener('change', loadInventory);

// ✅ Init
checkSession();
