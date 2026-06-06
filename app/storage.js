const STORAGE_KEY = 'cowxotp.accounts';

module.exports = {
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  },

  save(accounts) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  },

  add(account) {
    const accounts = this.getAll();
    account.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    account.createdAt = Date.now();
    accounts.unshift(account);
    this.save(accounts);
    return account;
  },

  update(id, data) {
    const accounts = this.getAll();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) return null;
    accounts[idx] = { ...accounts[idx], ...data };
    this.save(accounts);
    return accounts[idx];
  },

  remove(id) {
    const accounts = this.getAll();
    const filtered = accounts.filter(a => a.id !== id);
    if (filtered.length === accounts.length) return false;
    this.save(filtered);
    return true;
  }
};
