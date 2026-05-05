
import { WardrobeItem, Outfit } from "../types";

const DB_NAME = "SmartWardrobeDB";
const STORE_ITEMS = "wardrobe_items";
const STORE_OUTFITS = "wardrobe_outfits";
const DB_VERSION = 1;
const BACKUP_FILENAME = "wardrobe_data_backup.json";

class StorageService {
  private db: IDBDatabase | null = null;
  private dirHandle: any = null; 

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_ITEMS)) {
          db.createObjectStore(STORE_ITEMS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_OUTFITS)) {
          db.createObjectStore(STORE_OUTFITS, { keyPath: "id" });
        }
      };
      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        resolve(this.db!);
      };
      request.onerror = () => reject("Failed to open IndexedDB");
    });
  }

  // --- IndexedDB Operations ---

  async saveItems(items: WardrobeItem[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ITEMS, "readwrite");
      const store = tx.objectStore(STORE_ITEMS);
      store.clear();
      for (const item of items) store.add(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getItems(): Promise<WardrobeItem[]> {
    const db = await this.getDB();
    const tx = db.transaction(STORE_ITEMS, "readonly");
    const store = tx.objectStore(STORE_ITEMS);
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async saveOutfits(outfits: Outfit[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OUTFITS, "readwrite");
      const store = tx.objectStore(STORE_OUTFITS);
      store.clear();
      for (const outfit of outfits) store.add(outfit);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getOutfits(): Promise<Outfit[]> {
    const db = await this.getDB();
    const tx = db.transaction(STORE_OUTFITS, "readonly");
    const store = tx.objectStore(STORE_OUTFITS);
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  // --- File System / Backup Operations ---

  /**
   * 检查是否支持 File System Access API (主要见于桌面端 Chrome)
   */
  isFileSystemSupported(): boolean {
    return typeof window !== 'undefined' && !!(window as any).showDirectoryPicker;
  }

  async linkDirectory(): Promise<boolean> {
    if (!this.isFileSystemSupported()) return false;
    try {
      this.dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      return true;
    } catch (e) {
      console.warn("User cancelled or directory picker failed", e);
      return false;
    }
  }

  async syncToDirectory(items: WardrobeItem[], outfits: Outfit[]): Promise<void> {
    if (!this.dirHandle) return;
    try {
      const fileHandle = await this.dirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
      const writable = await fileHandle.createWritable();
      const backupData = this.prepareBackupData(items, outfits);
      await writable.write(JSON.stringify(backupData, null, 2));
      await writable.close();
    } catch (e) {
      console.error("Sync to physical directory failed", e);
      throw e;
    }
  }

  async loadFromDirectory(): Promise<{ items: WardrobeItem[], outfits: Outfit[] } | null> {
    if (!this.dirHandle) return null;
    try {
      const fileHandle = await this.dirHandle.getFileHandle(BACKUP_FILENAME);
      const file = await fileHandle.getFile();
      const content = await file.text();
      return await this.importFromJson(content);
    } catch (e) {
      console.warn("No backup file found in directory", e);
    }
    return null;
  }

  // --- Manual JSON Import/Export (Fallback for Mobile) ---

  prepareBackupData(items: WardrobeItem[], outfits: Outfit[]) {
    return {
      app: "SmartWardrobeAI",
      version: DB_VERSION,
      timestamp: Date.now(),
      items,
      outfits
    };
  }

  async importFromJson(jsonString: string): Promise<{ items: WardrobeItem[], outfits: Outfit[] } | null> {
    try {
      const data = JSON.parse(jsonString);
      if (data && data.items) {
        await this.saveItems(data.items);
        await this.saveOutfits(data.outfits || []);
        return { items: data.items, outfits: data.outfits || [] };
      }
    } catch (e) {
      console.error("Failed to parse backup JSON", e);
    }
    return null;
  }

  async migrateFromLocalStorage(): Promise<{ items: WardrobeItem[], outfits: Outfit[] } | null> {
    const localItems = localStorage.getItem('wardrobe_items');
    const localOutfits = localStorage.getItem('wardrobe_outfits');
    if (localItems || localOutfits) {
      const items = localItems ? JSON.parse(localItems) : [];
      const outfits = localOutfits ? JSON.parse(localOutfits) : [];
      if (items.length > 0) await this.saveItems(items);
      if (outfits.length > 0) await this.saveOutfits(outfits);
      localStorage.removeItem('wardrobe_items');
      localStorage.removeItem('wardrobe_outfits');
      return { items, outfits };
    }
    return null;
  }
}

export const storage = new StorageService();
