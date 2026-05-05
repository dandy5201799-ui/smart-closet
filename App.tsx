
import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { Camera, X, Shirt, Sparkles, ArrowLeft, Trash2, Wand2, Maximize, Loader2, Plus, ChevronRight, Eraser, Undo, Check, LayoutGrid, RefreshCw, AlertCircle, Database, FolderOpen, HardDrive, Download, Upload, Link2 } from 'lucide-react';
import { analyzeClothingImage, generateOutfitSuggestion, generateOutfitImage } from './services/aiService';
import { getApiSetupStatus, hasKimiApiKey, canGenerateOutfitImage } from './services/envStatus';
import { storage } from './services/storageService';
import { resizeImage, floodFillRemove, dataUrlToFile } from './utils/imageUtils';
import { resolveWardrobeItemsByOutfitIds } from './utils/outfitResolve';
import { extractAllDouyinUrlsFromText, fetchDouyinCoverForUrl } from './services/douyinLinkService';
import { getOutfitWeatherContext } from './services/outfitWeatherContext';
import { Button } from './components/Button';
import { AppState, WardrobeItem, Outfit } from './types';

const BASE_COLORS = ['黑色', '白色', '灰色', '红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '粉色', '棕色', '其它'];

const mapToBaseColor = (specificColor: string): string => {
  if (!specificColor) return '其它';
  const c = specificColor.toLowerCase();
  if (c.includes('黑')) return '黑色';
  if (c.includes('白')) return '白色';
  if (c.includes('灰')) return '灰色';
  if (c.includes('红')) return '红色';
  if (c.includes('橙') || c.includes('橘')) return '橙色';
  if (c.includes('黄')) return '黄色';
  if (c.includes('绿')) return '绿色';
  if (c.includes('蓝')) return '蓝色';
  if (c.includes('紫')) return '紫色';
  if (c.includes('粉')) return '粉色';
  if (c.includes('棕') || c.includes('褐') || c.includes('咖')) return '棕色';
  return '其它';
};

const makePendingWardrobeItem = (id: string, imageUrl: string, extra?: Partial<WardrobeItem>): WardrobeItem => ({
  id,
  imageUrl,
  createdAt: Date.now(),
  analysisPending: true,
  name: "识别中…",
  category: "上装",
  color: "其它",
  style: "休闲",
  material: "棉麻",
  occasion: "通勤",
  description: "正在识别中…",
  ...extra,
});

export default function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isInitializing, setIsInitializing] = useState(true);
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [activeTab, setActiveTab] = useState<'wardrobe' | 'outfits'>('wardrobe');
  const [processingStatus, setProcessingStatus] = useState('');
  
  const [selectedColorFilter, setSelectedColorFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [isEditMode, setIsEditMode] = useState<'none' | 'crop' | 'wand' | 'eraser'>('none');
  const [brushSize] = useState(30);
  const [wandTolerance] = useState(30);

  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [hasLinkedDir, setHasLinkedDir] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [currentOutfit, setCurrentOutfit] = useState<Outfit | null>(null);
  const [isGeneratingImg, setIsGeneratingImg] = useState(false);
  const [showOriginalGrid, setShowOriginalGrid] = useState(false);

  /** 后台识图：不进入 PROCESSING 全屏；先展示加载区，可收起为顶栏细条，不挡底部 FAB */
  const [bgRecognition, setBgRecognition] = useState<{ label: string; collapsed: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [douyinPaste, setDouyinPaste] = useState('');
  const [showAddItemSheet, setShowAddItemSheet] = useState(false);
  const [addItemSheetStep, setAddItemSheetStep] = useState<'choose' | 'douyin'>('choose');

  const [error, setError] = useState<{ message: string; action: () => void; actionLabel?: string } | null>(null);
  const isCanceled = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  // Swipe Gesture State
  const [touchStart, setTouchStart] = useState<{x: number, y: number} | null>(null);
  const [touchEnd, setTouchEnd] = useState<{x: number, y: number} | null>(null);
  const minSwipeDistance = 50;

  const availableBaseColors = useMemo(() => {
    const activeBases = new Set<string>();
    items.forEach(item => activeBases.add(mapToBaseColor(item.color)));
    return BASE_COLORS.filter(bc => activeBases.has(bc));
  }, [items]);

  const apiSetup = useMemo(() => getApiSetupStatus(), []);
  const kimiReady = hasKimiApiKey();
  const outfitImageReady = canGenerateOutfitImage();

  useEffect(() => {
    async function init() {
      try {
        const migrated = await storage.migrateFromLocalStorage();
        if (migrated) {
          setItems(migrated.items);
          setOutfits(migrated.outfits);
        } else {
          const storedItems = await storage.getItems();
          const storedOutfits = await storage.getOutfits();
          setItems(storedItems);
          setOutfits(storedOutfits);
        }
      } catch (e) {
        console.error("Failed to load data:", e);
      } finally {
        setIsInitializing(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!isInitializing) {
      storage.saveItems(items);
      if (hasLinkedDir) {
        storage.syncToDirectory(items, outfits).catch(() => setHasLinkedDir(false));
      }
    }
  }, [items, isInitializing, hasLinkedDir]);

  useEffect(() => {
    if (!isInitializing) {
      storage.saveOutfits(outfits);
      if (hasLinkedDir) {
        storage.syncToDirectory(items, outfits).catch(() => setHasLinkedDir(false));
      }
    }
  }, [outfits, isInitializing, hasLinkedDir]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useLayoutEffect(() => {
    if (appState === AppState.ITEM_DETAIL && selectedItem && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = selectedItem.imageUrl;
    }
  }, [appState, selectedItem?.imageUrl]);

  const handleLinkDir = async () => {
    if (!storage.isFileSystemSupported()) {
      alert("当前手机浏览器不支持文件夹同步。请使用下方的“手动导出/导入”功能备份数据。");
      return;
    }
    const success = await storage.linkDirectory();
    if (success) {
      setHasLinkedDir(true);
      const backup = await storage.loadFromDirectory();
      if (backup) {
        setItems(backup.items);
        setOutfits(backup.outfits);
      }
      setShowSyncPanel(false);
    }
  };

  const handleManualSync = async () => {
    if (!hasLinkedDir) return handleLinkDir();
    setIsSyncing(true);
    try {
      await storage.syncToDirectory(items, outfits);
      setIsSyncing(false);
      setShowSyncPanel(false);
    } catch (e) {
      setIsSyncing(false);
      alert("同步失败，请确保文件夹权限已授予。");
    }
  };

  const handleExportFile = () => {
    const backupData = storage.prepareBackupData(items, outfits);
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wardrobe_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowSyncPanel(false);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const backup = await storage.importFromJson(content);
      if (backup) {
        setItems(backup.items);
        setOutfits(backup.outfits);
        alert("导入成功！");
      } else {
        alert("文件无效或已损坏。");
      }
      setShowSyncPanel(false);
    };
    reader.readAsText(file);
    e.target.value = ''; 
  };

  const handleBack = () => {
    if (isEditMode !== 'none') {
      setIsEditMode('none');
      return;
    }
    if (appState === AppState.ITEM_DETAIL) {
      setAppState(AppState.IDLE);
      setSelectedItem(null);
      setEditHistory([]);
    } else if (appState === AppState.OUTFIT_GENERATION) {
      setAppState(AppState.IDLE);
      setCurrentOutfit(null);
      setActiveTab('outfits'); // 确保返回时处于灵感列表 Tab
    }
  };

  const handleCancel = () => {
    isCanceled.current = true;
    setAppState(AppState.IDLE);
    setIsGeneratingImg(false);
    setError(null);
  };

  const stopBackgroundRecognition = () => {
    isCanceled.current = true;
    setBgRecognition(null);
  };

  const pushToHistory = (imageUrl: string) => {
    if (!selectedItem) return;
    setEditHistory(prev => [...prev, selectedItem.imageUrl]);
    const updated = { ...selectedItem, imageUrl };
    setItems(items.map(i => i.id === selectedItem.id ? updated : i));
    setSelectedItem(updated);
  };

  const undoEdit = () => {
    if (editHistory.length === 0 || !selectedItem) return;
    const previous = editHistory[editHistory.length - 1];
    const newHistory = editHistory.slice(0, -1);
    const updated = { ...selectedItem, imageUrl: previous };
    setEditHistory(newHistory);
    setItems(items.map(i => i.id === selectedItem.id ? updated : i));
    setSelectedItem(updated);
  };

  const handleWandClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isEditMode !== 'wand' || !selectedItem || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height;
    const newBase64 = await floodFillRemove(selectedItem.imageUrl, x, y, wandTolerance);
    pushToHistory(newBase64);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditMode === 'eraser') {
      isDrawing.current = true;
      draw(e);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDrawing.current) {
      draw(e);
    }
  };

  const handlePointerUp = () => {
    if (isDrawing.current && canvasRef.current) {
      isDrawing.current = false;
      pushToHistory(canvasRef.current.toDataURL('image/png'));
    }
  };

  const draw = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files) as File[];
    e.target.value = "";

    if (!apiSetup.canRecognizeClothes) {
      setError({
        message: apiSetup.warnings[0] ?? "请先在 .env 中配置 KIMI_API_KEY（参考 .env.example）。",
        action: () => setError(null),
        actionLabel: "知道了",
      });
      return;
    }

    void (async () => {
      setError(null);
      isCanceled.current = false;
      const total = files.length;
      setBgRecognition({ label: `准备录入 ${total} 件…`, collapsed: false });
      const failures: string[] = [];
      try {
        for (let i = 0; i < total; i++) {
          if (isCanceled.current) break;
          setBgRecognition((prev) =>
            prev ? { ...prev, label: `录入 ${i + 1}/${total}…` } : null
          );
          const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
          try {
            const base64 = await resizeImage(files[i], 600);
            setItems((prev) => [makePendingWardrobeItem(id, base64), ...prev]);
            setBgRecognition((prev) =>
              prev ? { ...prev, label: `识图中 ${i + 1}/${total}…` } : null
            );
            const analysis = await analyzeClothingImage(base64);
            if (isCanceled.current) break;
            setItems((prev) =>
              prev.map((it) =>
                it.id === id ? { ...it, ...analysis, analysisPending: false } : it
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "识别失败";
            failures.push(`第 ${i + 1} 张：${msg.slice(0, 72)}`);
            setItems((prev) =>
              prev.map((it) =>
                it.id === id
                  ? {
                      ...it,
                      analysisPending: false,
                      name: "识别失败",
                      description: msg,
                    }
                  : it
              )
            );
          }
        }
      } finally {
        if (isCanceled.current) {
          setItems((prev) =>
            prev.map((it) =>
              it.analysisPending
                ? {
                    ...it,
                    analysisPending: false,
                    name: "已取消",
                    description: "录入已停止",
                  }
                : it
            )
          );
        }
        setBgRecognition(null);
        if (failures.length > 0 && !isCanceled.current) {
          setToast(
            failures.length === 1
              ? failures[0]
              : `${failures.length} 张出错：${failures[0]}`
          );
        }
      }
    })();
  };

  const handleDouyinIngest = () => {
    const paste = douyinPaste.trim();
    if (!paste) return;
    if (!apiSetup.canRecognizeClothes) {
      setError({
        message: apiSetup.warnings[0] ?? "请先在 .env 中配置 KIMI_API_KEY（参考 .env.example）。",
        action: () => setError(null),
        actionLabel: "知道了",
      });
      return;
    }
    const urls = extractAllDouyinUrlsFromText(paste);
    if (urls.length === 0) {
      setToast("未识别到抖音链接。可每行粘贴一段分享文案，或一行内多条 v.douyin.com 短链。");
      return;
    }
    void (async () => {
      setError(null);
      isCanceled.current = false;
      setDouyinPaste("");
      setShowAddItemSheet(false);
      setAddItemSheetStep("choose");
      const total = urls.length;
      setBgRecognition({
        label: total > 1 ? `准备解析 ${total} 条抖音链接…` : "正在解析抖音链接…",
        collapsed: false,
      });
      let ok = 0;
      const failures: string[] = [];
      try {
        for (let i = 0; i < total; i++) {
          if (isCanceled.current) break;
          const link = urls[i];
          const id = `${Date.now()}-dy-${i}-${Math.random().toString(36).slice(2, 9)}`;
          setBgRecognition((prev) =>
            prev
              ? {
                  ...prev,
                  label: total > 1 ? `抖音 ${i + 1}/${total}：拉取封面…` : "正在解析抖音链接…",
                }
              : null
          );
          try {
            const dataUrl = await fetchDouyinCoverForUrl(link);
            if (isCanceled.current) break;
            const file = await dataUrlToFile(dataUrl, `douyin-${i}.jpg`);
            const base64 = await resizeImage(file, 600);
            setItems((prev) => [
              makePendingWardrobeItem(id, base64, { douyinSourceUrl: link }),
              ...prev,
            ]);
            setBgRecognition((prev) =>
              prev
                ? {
                    ...prev,
                    label: total > 1 ? `抖音 ${i + 1}/${total}：识图中…` : "正在识别封面…",
                  }
                : null
            );
            const analysis = await analyzeClothingImage(base64);
            if (isCanceled.current) break;
            setItems((prev) =>
              prev.map((it) =>
                it.id === id
                  ? { ...it, ...analysis, analysisPending: false, douyinSourceUrl: link }
                  : it
              )
            );
            ok += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "失败";
            failures.push(`第 ${i + 1} 条：${msg.slice(0, 80)}${msg.length > 80 ? "…" : ""}`);
            setItems((prev) => {
              const exists = prev.some((it) => it.id === id);
              if (!exists) return prev;
              return prev.map((it) =>
                it.id === id
                  ? {
                      ...it,
                      analysisPending: false,
                      name: "识别失败",
                      description: msg,
                      douyinSourceUrl: link,
                    }
                  : it
              );
            });
          }
        }
        if (!isCanceled.current) {
          if (failures.length === 0) {
            setToast(ok === 1 ? "已从抖音链接录入 1 件单品" : `已从抖音链接录入 ${ok} 件单品`);
          } else if (ok === 0) {
            setToast(`全部失败（${failures.length} 条）。${failures[0]}`);
          } else {
            setToast(`录入 ${ok} 件，失败 ${failures.length} 条。${failures[0]}`);
          }
        }
      } finally {
        if (isCanceled.current) {
          setItems((prev) =>
            prev.map((it) =>
              it.analysisPending
                ? {
                    ...it,
                    analysisPending: false,
                    name: "已取消",
                    description: "录入已停止",
                  }
                : it
            )
          );
        }
        setBgRecognition(null);
      }
    })();
  };

  const openAddItemSheet = () => {
    setAddItemSheetStep("choose");
    setShowAddItemSheet(true);
  };

  const closeAddItemSheet = () => {
    setShowAddItemSheet(false);
    setAddItemSheetStep("choose");
  };

  const pickPhotosFromSheet = () => {
    closeAddItemSheet();
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const toggleItemSelection = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedId(prev => prev === id ? null : id);
  };

  const handleSuggest = async (specificIds?: string[]) => {
    let idsToUse = specificIds || (selectedId ? [selectedId] : []);
    if (items.length < 2) return alert("请先录入至少 2 件单品");
    const performSuggest = async () => {
      setError(null);
      isCanceled.current = false;
      if (!kimiReady) {
        setError({
          message:
            "「AI 搭配」需要 Kimi：请在 .env 中填写 KIMI_API_KEY 或 MOONSHOT_API_KEY（见 .env.example），保存后重新执行 npm run dev。",
          action: () => setError(null),
          actionLabel: "知道了",
        });
        return;
      }
      setAppState(AppState.PROCESSING);
      setProcessingStatus("正在获取当地天气…");
      const { context: weatherContext, toastMessage } = await getOutfitWeatherContext();
      if (isCanceled.current) return;
      if (toastMessage) setToast(toastMessage);
      setProcessingStatus("AI 搭配师正在构思中...");
      try {
        const res = await generateOutfitSuggestion(items, idsToUse, outfits, weatherContext);
        if (isCanceled.current) return;
        const newIdsSorted = [...res.itemIds].sort().join(",");
        const existingOutfit = outfits.find((o) => [...o.itemIds].sort().join(",") === newIdsSorted);

        const applyGeneratedImage = async (base: Outfit): Promise<Outfit> => {
          if (!outfitImageReady) return base;
          if (base.generatedImageUrl) return base;
          setProcessingStatus("正在生成穿搭效果图…");
          try {
            const outfitItems = resolveWardrobeItemsByOutfitIds(base.itemIds, items);
            const url = await generateOutfitImage(outfitItems);
            return { ...base, generatedImageUrl: url };
          } catch (e) {
            const hint = e instanceof Error ? e.message : "网络或接口错误";
            setToast(`搭配已生成，但穿搭效果图失败：${hint.slice(0, 120)}${hint.length > 120 ? "…" : ""} 可在详情页重试。`);
          }
          return base;
        };

        if (existingOutfit) {
          const mergedBase: Outfit = {
            ...existingOutfit,
            title: res.title,
            reason: res.reason,
            itemIds: res.itemIds,
            suitableTempRange: res.suitableTempRange,
            suitableWeather: res.suitableWeather,
          };
          const updated = await applyGeneratedImage(mergedBase);
          setOutfits((prev) => prev.map((o) => (o.id === existingOutfit.id ? updated : o)));
          setCurrentOutfit(updated);
        } else {
          let newOutfit: Outfit = { ...res, id: Date.now().toString(), createdAt: Date.now() };
          newOutfit = await applyGeneratedImage(newOutfit);
          setOutfits((prev) => [newOutfit, ...prev]);
          setCurrentOutfit(newOutfit);
        }
        setAppState(AppState.OUTFIT_GENERATION);
        setSelectedId(null);
      } catch (err) {
        if (isCanceled.current) return;
        setError({ message: "AI 暂时没灵感了，请重试。", action: performSuggest });
      }
    };
    performSuggest();
  };

  const handleQuickSuggest = () => {
    if (selectedId) {
      handleSuggest([selectedId]);
      return;
    }
    if (selectedColorFilter && activeTab === 'wardrobe') {
      const filtered = items.filter(item => mapToBaseColor(item.color) === selectedColorFilter);
      if (filtered.length > 0) {
        const randomIndex = Math.floor(Math.random() * filtered.length);
        handleSuggest([filtered[randomIndex].id]);
        return;
      }
    }
    handleSuggest();
  };

  const handleGenerateOutfitImgAction = async () => {
    if (!currentOutfit) return;
    const performRender = async () => {
      setError(null);
      isCanceled.current = false;
      if (!outfitImageReady) {
        setError({
          message:
            "「模特上身图」需要火山方舟：请在 .env 中填写 ARK_API_KEY（见 .env.example），保存后重新执行 npm run dev。",
          action: () => setError(null),
          actionLabel: "知道了",
        });
        return;
      }
      setIsGeneratingImg(true);
      setProcessingStatus("AI 正在渲染您的 3D 上身大片...");
      try {
        const url = await generateOutfitImage(resolveWardrobeItemsByOutfitIds(currentOutfit.itemIds, items));
        if (isCanceled.current) return;
        const updatedOutfit = { ...currentOutfit, generatedImageUrl: url };
        setCurrentOutfit(updatedOutfit);
        setOutfits(prev => prev.map(o => o.id === currentOutfit.id ? updatedOutfit : o));
      } catch (err) {
        if (isCanceled.current) return;
        const msg = err instanceof Error ? err.message : "渲染失败，请重试。";
        setError({
          message: msg.length > 360 ? `${msg.slice(0, 360)}…` : msg,
          action: performRender,
          actionLabel: "重试",
        });
      } finally {
        setIsGeneratingImg(false);
      }
    };
    performRender();
  };

  // --- Gestures ---
  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distanceX = touchStart.x - touchEnd.x;
    const distanceY = touchStart.y - touchEnd.y;
    const isHorizontal = Math.abs(distanceX) > Math.abs(distanceY);

    if (isHorizontal && Math.abs(distanceX) > minSwipeDistance) {
        const isLeftSwipe = distanceX > 0;
        const isRightSwipe = distanceX < 0;

        if (appState === AppState.IDLE) {
             if (isLeftSwipe && activeTab === 'wardrobe') setActiveTab('outfits');
             if (isRightSwipe && activeTab === 'outfits') setActiveTab('wardrobe');
        } else if (appState === AppState.ITEM_DETAIL || appState === AppState.OUTFIT_GENERATION) {
             if (isEditMode !== 'none') return;
             // Allow both swipe directions to exit as requested ("左滑右滑退出")
             handleBack();
        }
    }
  };

  if (isInitializing) {
    return (
      <div className="h-full bg-stone-50 flex flex-col items-center justify-center p-8">
        <Database className="w-10 h-10 text-stone-300 mb-4 animate-pulse" />
        <p className="text-stone-400 font-medium tracking-widest text-xs uppercase">LOADING...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-white flex flex-col items-center justify-center p-8 text-center">
        <AlertCircle size={40} className="text-stone-900 mb-6" />
        <h2 className="text-lg font-bold text-stone-900 mb-2">出错了</h2>
        <p className="text-stone-500 mb-8 text-sm leading-relaxed max-w-[200px] mx-auto">{error.message}</p>
        <Button onClick={error.action}>{error.actionLabel ?? "立即重试"}</Button>
        <Button variant="ghost" onClick={handleCancel} className="mt-4">返回</Button>
      </div>
    );
  }

  if (appState === AppState.PROCESSING) {
    return (
      <div className="h-full bg-white/80 backdrop-blur-xl flex flex-col items-center justify-center p-12 z-50">
        <Loader2 className="w-12 h-12 text-stone-900 animate-spin mb-8" />
        <p className="text-stone-900 font-bold text-lg text-center mb-8 animate-pulse tracking-wide">{processingStatus}</p>
        <Button variant="secondary" onClick={handleCancel} className="text-sm px-8">取消</Button>
      </div>
    );
  }

  const safeAreaTop = { paddingTop: 'var(--safe-area-inset-top)' };
  
  // 优化布局间距，增加留白
  const listContainerClass = "px-6 pt-6 space-y-12 pb-[calc(5rem+env(safe-area-inset-bottom))]";
  const outfitContainerClass = "px-6 pt-6 space-y-8 pb-[calc(5rem+env(safe-area-inset-bottom))]";

  const filteredItems = items.filter(item => !selectedColorFilter || mapToBaseColor(item.color) === selectedColorFilter);
  const groupedItems = filteredItems.reduce((acc, item) => {
    const cat = item.category || '未分类';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, WardrobeItem[]>);

  const isFsSupported = storage.isFileSystemSupported();

  // Helper for Outfit Detail Rendering
  const isOutfitDetailVisible = appState === AppState.OUTFIT_GENERATION && currentOutfit;
  const isShowingGeneratedImage = currentOutfit?.generatedImageUrl && !showOriginalGrid;
  const shouldUseAspectRatio = isGeneratingImg || isShowingGeneratedImage;

return (
  <div 
    className="flex-1 flex flex-col relative overflow-hidden bg-stone-50"
    style={{ height: '100dvh' }} // 使用 dvh 确保在移动端完美填充视窗，不多不少
  >
      {/* Header - 极简主义设计 */}
      <header className="bg-stone-50/80 backdrop-blur-md z-[40] shrink-0" style={safeAreaTop}>
        <div className="px-6 h-14 flex justify-between items-center">
          <h1 className="text-xl font-bold text-stone-900 tracking-widest">智能衣橱<span className="text-brand-500 text-sm ml-1 font-bold">AI</span></h1>
          
          <button 
            onClick={() => setShowSyncPanel(!showSyncPanel)}
            className={`w-2 h-2 rounded-full transition-all ${hasLinkedDir ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-stone-300'}`}
          />
        </div>

        {/* Tabs - 文本切换风格 */}
        <div className="px-6 pb-2 flex items-center gap-6">
           <button onClick={() => setActiveTab('wardrobe')} className={`pb-2 text-sm font-bold tracking-wider transition-all relative ${activeTab === 'wardrobe' ? 'text-stone-900' : 'text-stone-400'}`}>
             衣橱
             {activeTab === 'wardrobe' && <span className="absolute bottom-0 left-0 w-full h-[2px] bg-stone-900" />}
           </button>
           <button onClick={() => setActiveTab('outfits')} className={`pb-2 text-sm font-bold tracking-wider transition-all relative ${activeTab === 'outfits' ? 'text-stone-900' : 'text-stone-400'}`}>
             灵感
             {activeTab === 'outfits' && <span className="absolute bottom-0 left-0 w-full h-[2px] bg-stone-900" />}
           </button>
        </div>

        {/* Filters - 极简胶囊 */}
        {activeTab === 'wardrobe' && availableBaseColors.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-3 px-6 mask-fade-right">
            <button 
              onClick={() => setSelectedColorFilter(null)} 
              className={`px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider shrink-0 transition-all border ${!selectedColorFilter ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-400 border-stone-200'}`}
            >
              全部
            </button>
            {availableBaseColors.map(color => (
              <button key={color} onClick={() => setSelectedColorFilter(selectedColorFilter === color ? null : color)} className={`px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider shrink-0 transition-all border ${selectedColorFilter === color ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-400 border-stone-200'}`}>{color}</button>
            ))}
          </div>
        )}
        {apiSetup.warnings.length > 0 && (
          <div className="px-6 pb-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-[11px] leading-relaxed text-amber-950">
              {apiSetup.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          </div>
        )}
      </header>

      {bgRecognition && (
        <div
          className="shrink-0 z-[30] border-b border-stone-200/90 bg-white/95 backdrop-blur-md px-5 shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          role="status"
          aria-live="polite"
        >
          {bgRecognition.collapsed ? (
            <div className="flex items-center gap-2 py-2 min-h-[2.5rem]">
              <Loader2 className="w-4 h-4 text-stone-900 shrink-0 animate-spin" />
              <span className="text-xs font-medium text-stone-700 truncate flex-1 min-w-0">
                {bgRecognition.label}
              </span>
              <button
                type="button"
                onClick={() =>
                  setBgRecognition((p) => (p ? { ...p, collapsed: false } : null))
                }
                className="shrink-0 text-[11px] font-bold text-stone-500 uppercase tracking-wider px-2.5 py-1 rounded-full bg-stone-100 hover:bg-stone-200"
              >
                展开
              </button>
              <button
                type="button"
                onClick={stopBackgroundRecognition}
                className="shrink-0 text-[11px] font-bold text-stone-600 uppercase tracking-wider px-2.5 py-1 rounded-full bg-stone-200 hover:bg-stone-300"
              >
                停止
              </button>
            </div>
          ) : (
            <div className="py-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-stone-100 flex items-center justify-center shrink-0">
                  <Loader2 className="w-6 h-6 text-stone-900 animate-spin" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-bold text-stone-900">正在识图</p>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">{bgRecognition.label}</p>
                  <p className="text-[10px] text-stone-400 mt-2">可继续使用底部按钮；收起后仅保留顶栏进度条。</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setBgRecognition((p) => (p ? { ...p, collapsed: true } : null))
                  }
                  className="text-xs font-bold text-stone-500 uppercase tracking-wider px-4 py-2 rounded-full bg-stone-100 hover:bg-stone-200"
                >
                  收起为条
                </button>
                <button
                  type="button"
                  onClick={stopBackgroundRecognition}
                  className="text-xs font-bold text-stone-700 uppercase tracking-wider px-4 py-2 rounded-full bg-stone-200 hover:bg-stone-300"
                >
                  停止
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Area */}
      <main 
        className="flex-1 overflow-y-auto overscroll-contain flex flex-col no-scrollbar -webkit-overflow-scrolling-touch bg-stone-50"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {activeTab === 'wardrobe' ? (
          items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-fade-in-up">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 text-stone-300 shadow-sm border border-stone-100">
                <Shirt size={32} />
              </div>
              <h2 className="text-lg font-bold text-stone-900 mb-2 tracking-wide">你的衣橱是空的</h2>
              <p className="text-stone-400 text-xs mb-8 max-w-[200px] leading-relaxed">开始录入你的时尚单品，AI 将为你管理一切。</p>
              
              <div className="flex flex-col gap-3 w-auto">
                <Button onClick={openAddItemSheet}>
                  <Plus size={18} className="mr-2" /> 录入单品
                </Button>
                <Button variant="ghost" onClick={() => setShowSyncPanel(true)} className="text-xs">
                  恢复数据
                </Button>
              </div>
            </div>
          ) : (
            <div className={listContainerClass}>
              {Object.entries(groupedItems).map(([category, catItems], idx) => (
                <div key={category} className="space-y-5">
                  <h2 className="text-xs font-bold text-stone-400 uppercase tracking-[0.2em] ml-1">{category}</h2>
                  <div className="grid grid-cols-2 gap-4">
                    {(catItems as WardrobeItem[]).map((item) => (
                      <div key={item.id} onClick={() => { setSelectedItem(item); setAppState(AppState.ITEM_DETAIL); }} className="relative group cursor-pointer">
                        {/* Image Container */}
                        <div className="aspect-[3/4] bg-white rounded-[20px] p-4 flex items-center justify-center overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform active:scale-[0.98]">
                           <img src={item.imageUrl} className="w-full h-full object-contain mix-blend-multiply" />
                        </div>
                        
                        {/* 独立的单选按钮区域 - 放置在左上角，阻止冒泡，点击切换选中状态 */}
                        <button 
                          onClick={(e) => toggleItemSelection(item.id, e)} 
                          className="absolute top-0 left-0 p-3 z-20 focus:outline-none"
                        >
                           <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm transition-all ${selectedId === item.id ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white/60 backdrop-blur-sm border-stone-200 text-transparent'}`}>
                              <Check size={12} strokeWidth={4} />
                           </div>
                        </button>

                        <div className="mt-3 px-1">
                          <p
                            className={`text-xs font-bold truncate flex items-center gap-1.5 ${
                              item.analysisPending ? "text-stone-400" : "text-stone-900"
                            }`}
                          >
                            {item.analysisPending && (
                              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-stone-400" />
                            )}
                            <span className="truncate">{item.name}</span>
                          </p>
                          <p
                            className={`text-[10px] font-medium uppercase mt-0.5 tracking-wide ${
                              item.analysisPending ? "text-stone-300" : "text-stone-400"
                            }`}
                          >
                            {item.analysisPending ? "…" : item.color}
                          </p>
                        </div>
                      </div>
                    ))}
                    {/* Add Button in Grid */}
                    {idx === Object.keys(groupedItems).length - 1 && (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddItemSheet();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openAddItemSheet();
                          }
                        }}
                        className="aspect-[3/4] rounded-[20px] border border-dashed border-stone-200 flex flex-col items-center justify-center text-stone-300 hover:text-stone-400 hover:border-stone-300 transition-colors active:scale-[0.98] cursor-pointer"
                      >
                        <Plus size={32} strokeWidth={1.5} />
                        <span className="text-[10px] font-bold uppercase mt-3 tracking-widest">ADD NEW</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          outfits.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-fade-in-up">
              <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mb-6 text-brand-300">
                <Sparkles size={32} />
              </div>
              <h2 className="text-lg font-bold text-stone-900 mb-2 tracking-wide">寻找搭配灵感</h2>
              <p className="text-stone-400 text-xs mb-8 max-w-[220px] leading-relaxed">AI 造型师已准备就绪，为你打造专属 Look。</p>
              <Button
                onClick={handleQuickSuggest}
                variant="black"
                disabled={!kimiReady}
                title={!kimiReady ? "需要配置 KIMI_API_KEY" : undefined}
              >
                <Sparkles size={16} className="mr-2" /> 生成搭配
              </Button>
            </div>
          ) : (
            <div className={outfitContainerClass}>
              {outfits.map((o) => {
                const outfitItems = resolveWardrobeItemsByOutfitIds(o.itemIds, items).slice(0, 4);
                return (
                  <div key={o.id} onClick={() => { setCurrentOutfit(o); setAppState(AppState.OUTFIT_GENERATION); }} className="bg-white rounded-[24px] p-4 shadow-sm border border-stone-100 flex gap-5 items-center active:scale-[0.98] transition-all">
                    <div className="w-20 h-24 bg-stone-50 rounded-xl shrink-0 overflow-hidden relative">
                      {o.generatedImageUrl ? (
                        <img src={o.generatedImageUrl} className="w-full h-full object-cover" />
                      ) : (
                        <div className="grid grid-cols-2 h-full w-full gap-[1px]">
                          {outfitItems.map(item => (
                            <div key={item.id} className="bg-white flex items-center justify-center overflow-hidden">
                              <img src={item.imageUrl} className="w-full h-full object-contain p-1" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 py-2">
                      <h3 className="font-bold text-base text-stone-900 truncate tracking-tight">{o.title}</h3>
                      {(o.suitableTempRange || o.suitableWeather) && (
                        <p className="text-[10px] text-stone-500 mt-1 font-medium line-clamp-1">
                          {[o.suitableTempRange, o.suitableWeather].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <p className="text-xs text-stone-400 line-clamp-2 mt-2 leading-relaxed font-medium">{o.reason}</p>
                    </div>
                    <div className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-50 text-stone-300">
                        <ChevronRight size={16} />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </main>

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[55] max-w-[min(92vw,360px)] px-4 py-3 rounded-2xl bg-stone-900 text-white text-xs font-medium shadow-lg leading-relaxed"
          style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
          role="status"
        >
          {toast}
        </div>
      )}

      {showAddItemSheet && (
        <>
          <div
            className="ios-full-bleed-overlay z-[102] bg-stone-900/20 backdrop-blur-sm touch-none"
            onClick={closeAddItemSheet}
            aria-hidden
          />
          <div className="ios-full-bleed-overlay z-[103] flex items-end justify-center px-4 pb-8 pointer-events-none">
            <div
              className="relative bg-white w-full max-w-md rounded-[32px] p-6 shadow-2xl pointer-events-auto max-h-[min(85dvh,560px)] overflow-y-auto"
              style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 mb-6">
                <div className="flex justify-start">
                  {addItemSheetStep === "douyin" ? (
                    <button
                      type="button"
                      onClick={() => setAddItemSheetStep("choose")}
                      className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-stone-700 hover:bg-stone-200"
                      aria-label="返回"
                    >
                      <ArrowLeft size={18} />
                    </button>
                  ) : (
                    <span className="w-10" />
                  )}
                </div>
                <h2 className="text-lg font-bold text-stone-900 text-center truncate px-1">
                  {addItemSheetStep === "choose" ? "添加单品" : "批量粘贴抖音"}
                </h2>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeAddItemSheet}
                    className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 hover:bg-stone-200"
                    aria-label="关闭"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {addItemSheetStep === "choose" ? (
                <div className="space-y-3">
                  <Button
                    type="button"
                    fullWidth
                    variant="black"
                    className="h-14 justify-center gap-2"
                    onClick={pickPhotosFromSheet}
                    disabled={!!bgRecognition}
                  >
                    <Camera size={20} />
                    从相册选择照片
                  </Button>
                  <Button
                    type="button"
                    fullWidth
                    variant="secondary"
                    className="h-14 justify-center gap-2"
                    onClick={() => setAddItemSheetStep("douyin")}
                    disabled={!!bgRecognition}
                  >
                    <Link2 size={20} />
                    粘贴抖音链接（可多条）
                  </Button>
                  <p className="text-[10px] text-stone-400 leading-relaxed pt-2">
                    相册支持多选；抖音支持一次粘贴多条分享或短链。本地开发已支持链接解析，纯静态部署需配置 VITE_DOUYIN_PREVIEW_URL。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={douyinPaste}
                    onChange={(e) => setDouyinPaste(e.target.value)}
                    placeholder="每行一条分享文案，或一行内多条链接；会自动去重。"
                    rows={8}
                    disabled={!!bgRecognition}
                    className="w-full rounded-2xl border border-stone-200 bg-stone-50/80 px-3 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 resize-y min-h-[160px]"
                  />
                  <p className="text-[10px] text-stone-400 leading-relaxed">
                    商城分享参数里会尽量用「第二张」商品图做识图（无第二张时退回第一张）；与 App 内轮播不一定一致。将按顺序逐条处理，顶部可停止。
                  </p>
                  <Button
                    type="button"
                    fullWidth
                    variant="black"
                    className="h-12"
                    disabled={!douyinPaste.trim() || !!bgRecognition}
                    onClick={handleDouyinIngest}
                  >
                    批量解析并录入
                  </Button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Floating Action Bar - 灵动岛设计，宽度自适应 */}
      {items.length > 0 && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center z-40 pointer-events-none">
            <div className="flex items-center gap-3 p-2 bg-white/90 backdrop-blur-xl border border-stone-200/50 shadow-2xl rounded-full pointer-events-auto animate-fade-in-up">
                {/* 仅在不是（灵感页且无内容）的情况下显示 AI 搭配按钮 */}
                {!(activeTab === 'outfits' && outfits.length === 0) && (
                    <>
                        <Button
                          onClick={handleQuickSuggest}
                          variant="black"
                          className="h-12 px-6 shadow-none"
                          disabled={!kimiReady}
                          title={!kimiReady ? "需要配置 KIMI_API_KEY" : undefined}
                        >
                            <Sparkles className="w-4 h-4 mr-2 text-brand-300" />
                            <span className="text-sm">AI 搭配</span>
                        </Button>
                        <div className="w-[1px] h-6 bg-stone-200 mx-1"></div>
                    </>
                )}
                <button
                  type="button"
                  onClick={openAddItemSheet}
                  className="w-12 h-12 rounded-full bg-stone-100 text-stone-900 flex items-center justify-center hover:bg-stone-200 transition-colors"
                  title="添加单品"
                >
                    <Camera size={20} />
                </button>
            </div>
        </div>
      )}

      {/* Sync Panel Modal */}
      {showSyncPanel && (
        <>
          <div 
            className="ios-full-bleed-overlay z-[100] bg-stone-900/20 backdrop-blur-sm touch-none h-full w-full transition-opacity" 
            onClick={() => setShowSyncPanel(false)} 
          />
          <div className="ios-full-bleed-overlay z-[101] flex items-end justify-center px-4 pb-8 pointer-events-none">
            <div className="relative bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-in slide-in-from-bottom-10 pointer-events-auto">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold text-stone-900 flex items-center gap-2">
                  <HardDrive size={20} className="text-stone-400" /> 数据管理
                </h2>
                <button onClick={() => setShowSyncPanel(false)} className="bg-stone-100 p-2 rounded-full text-stone-500 hover:bg-stone-200"><X size={18} /></button>
              </div>

              <div className="space-y-4">
                {isFsSupported ? (
                  <div className="bg-stone-50 p-6 rounded-[24px]">
                    <p className="font-bold text-stone-900 text-sm mb-1">自动同步</p>
                    <p className="text-xs text-stone-500 mb-4">连接本地文件夹进行增量备份。</p>
                    <Button variant={hasLinkedDir ? 'secondary' : 'primary'} onClick={handleLinkDir} className="text-sm">
                      {hasLinkedDir ? '更换目录' : '选择文件夹'}
                    </Button>
                  </div>
                ) : (
                  // Grid Layout for Import/Export Buttons
                  <div className="grid grid-cols-2 gap-4">
                     <Button fullWidth onClick={handleExportFile} variant="secondary" className="flex-col gap-2 h-auto py-5 px-2 justify-center">
                        <Download size={20} className="text-stone-400" />
                        <span className="text-stone-900 font-bold text-xs">导出备份</span>
                     </Button>
                     <Button fullWidth onClick={() => backupInputRef.current?.click()} variant="secondary" className="flex-col gap-2 h-auto py-5 px-2 justify-center">
                        <Upload size={20} className="text-stone-400" />
                        <span className="text-stone-900 font-bold text-xs">导入恢复</span>
                     </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleUpload} />
      <input type="file" ref={backupInputRef} className="hidden" accept=".json" onChange={handleImportFile} />

      {/* Item Detail View - Magazine Style */}
      {appState === AppState.ITEM_DETAIL && selectedItem && (
        <div 
          className="ios-full-bleed-overlay bg-stone-50 z-[60] flex flex-col animate-in slide-in-from-right-5 overflow-hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
           {/* Top Navigation */}
           <div className="p-4 flex justify-between items-center shrink-0 bg-stone-50/80 backdrop-blur-md z-10" style={safeAreaTop}>
             <button onClick={handleBack} className="w-10 h-10 bg-white border border-stone-200 rounded-full flex items-center justify-center text-stone-900 shadow-sm"><ArrowLeft size={18} /></button>
             <div className="flex gap-2">
               <button onClick={undoEdit} disabled={editHistory.length === 0} className="w-10 h-10 text-stone-400 disabled:opacity-20 flex items-center justify-center"><Undo size={18}/></button>
               <button onClick={() => setIsEditMode(isEditMode === 'wand' ? 'none' : 'wand')} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isEditMode === 'wand' ? 'bg-stone-900 text-white' : 'text-stone-400 bg-stone-100'}`}><Wand2 size={16}/></button>
               <button onClick={() => setIsEditMode(isEditMode === 'eraser' ? 'none' : 'eraser')} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isEditMode === 'eraser' ? 'bg-stone-900 text-white' : 'text-stone-400 bg-stone-100'}`}><Eraser size={16}/></button>
               <button onClick={() => { if(confirm('删除此单品？')){ setItems(items.filter(i => i.id !== selectedItem.id)); setAppState(AppState.IDLE); } }} className="w-10 h-10 text-red-500 bg-red-50 rounded-full flex items-center justify-center ml-2"><Trash2 size={16}/></button>
             </div>
           </div>
           
           <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
             {/* Image Area */}
             <div className="w-full aspect-square bg-white flex items-center justify-center p-8 mb-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                <canvas 
                  ref={canvasRef} 
                  onClick={handleWandClick}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="max-h-full max-w-full object-contain touch-none cursor-crosshair drop-shadow-xl" 
                />
             </div>
             
             {/* Info Area */}
             <div className="px-8 max-w-md mx-auto">
               <div className="flex items-center gap-3 mb-4">
                 <span
                   className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full ${
                     selectedItem.analysisPending
                       ? "bg-stone-200 text-stone-500"
                       : "bg-stone-900 text-white"
                   }`}
                 >
                   {selectedItem.analysisPending ? "…" : selectedItem.category}
                 </span>
                 <span
                   className={`px-3 py-1 border text-[10px] font-bold uppercase tracking-widest rounded-full ${
                     selectedItem.analysisPending
                       ? "bg-stone-50 border-stone-100 text-stone-300"
                       : "bg-white border-stone-200 text-stone-500"
                   }`}
                 >
                   {selectedItem.analysisPending ? "…" : selectedItem.color}
                 </span>
               </div>
               
               <h1
                 className={`text-3xl font-black mb-3 tracking-tight leading-tight flex items-center gap-2 ${
                   selectedItem.analysisPending ? "text-stone-400" : "text-stone-900"
                 }`}
               >
                 {selectedItem.analysisPending && (
                   <Loader2 className="w-7 h-7 shrink-0 animate-spin text-stone-400" />
                 )}
                 {selectedItem.name}
               </h1>
               <p
                 className={`leading-relaxed text-sm font-medium mb-6 ${
                   selectedItem.analysisPending ? "text-stone-400 animate-pulse" : "text-stone-500"
                 }`}
               >
                 {selectedItem.description}
               </p>
               {selectedItem.douyinSourceUrl && (
                 <a
                   href={selectedItem.douyinSourceUrl}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 mb-8"
                 >
                   <Link2 size={14} />
                   打开抖音原链接
                 </a>
               )}
               
               <Button
                 onClick={() => handleSuggest([selectedItem.id])}
                 variant="black"
                 className="px-8 h-14 w-auto shadow-xl shadow-stone-900/20"
                 disabled={!kimiReady || !!selectedItem.analysisPending}
                 title={
                   selectedItem.analysisPending
                     ? "请等待识图完成"
                     : !kimiReady
                       ? "需要配置 KIMI_API_KEY"
                       : undefined
                 }
               >
                 <Sparkles size={16} className="mr-2 text-brand-400" /> 
                 <span className="tracking-wide">为此单品搭配</span>
               </Button>
             </div>
           </div>
        </div>
      )}

      {/* Outfit Generation View */}
      {isOutfitDetailVisible && currentOutfit && (
         <div 
           className="ios-full-bleed-overlay bg-stone-50 z-[60] flex flex-col animate-in slide-in-from-bottom-10"
           onTouchStart={onTouchStart}
           onTouchMove={onTouchMove}
           onTouchEnd={onTouchEnd}
         >
           <div className="p-4 bg-white/80 backdrop-blur-md border-b border-stone-100 flex justify-between items-center" style={safeAreaTop}>
             <button onClick={handleBack} className="w-10 h-10 bg-stone-50 rounded-full flex items-center justify-center text-stone-900"><ArrowLeft size={18} /></button>
             <span className="font-bold text-xs uppercase tracking-[0.2em] text-stone-900">Style Inspiration</span>
             <button onClick={() => { if(confirm('删除搭配？')){ setOutfits(outfits.filter(o => o.id !== currentOutfit.id)); setAppState(AppState.IDLE); setActiveTab('outfits'); } }} className="w-10 h-10 text-stone-300 hover:text-red-500 flex items-center justify-center"><Trash2 size={18}/></button>
           </div>
           
           <div className="flex-1 overflow-y-auto p-6 pb-32 no-scrollbar">
             <div className="bg-white rounded-[32px] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] mb-8">
                {/* Hero Area: Changes layout based on content */}
                <div className={`w-full ${shouldUseAspectRatio ? 'aspect-[3/4]' : ''} bg-stone-50 rounded-[24px] mb-8 overflow-hidden relative flex items-center justify-center group transition-all duration-300`}>
                  {isGeneratingImg ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                      <Loader2 className="w-8 h-8 text-stone-900 animate-spin mb-4" />
                      <p className="font-bold text-xs text-stone-500 uppercase tracking-widest">Generating Look...</p>
                    </div>
                  ) : isShowingGeneratedImage ? (
                    <img src={currentOutfit.generatedImageUrl} className="w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
                  ) : (
                    // Grid Mode: Natural Flow
                    <div className="grid grid-cols-2 gap-3 p-3 w-full">
                      {resolveWardrobeItemsByOutfitIds(currentOutfit.itemIds, items).map(item => (
                        // Each item card is aspect 3:4 to look uniform and nice
                        <div key={item.id} className="aspect-[3/4] bg-white rounded-xl p-3 flex items-center justify-center shadow-sm relative">
                           <img src={item.imageUrl} className="w-full h-full object-contain mix-blend-multiply" />
                        </div>
                      ))}
                    </div>
                  )}
                  {currentOutfit.generatedImageUrl && (
                    <button onClick={() => setShowOriginalGrid(!showOriginalGrid)} className="absolute bottom-4 right-4 bg-white/90 backdrop-blur shadow-sm p-2 rounded-xl text-stone-900 hover:scale-110 transition-transform"><LayoutGrid size={18} /></button>
                  )}
                </div>

                <div className="px-2">
                    <h2 className="text-2xl font-black text-stone-900 mb-3 tracking-tight">{currentOutfit.title}</h2>
                    {(currentOutfit.suitableTempRange || currentOutfit.suitableWeather) && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {currentOutfit.suitableTempRange ? (
                          <span className="text-xs font-semibold text-stone-700 bg-stone-100 px-3 py-1.5 rounded-full">
                            {currentOutfit.suitableTempRange}
                          </span>
                        ) : null}
                        {currentOutfit.suitableWeather ? (
                          <span className="text-xs font-semibold text-stone-700 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-100/80">
                            {currentOutfit.suitableWeather}
                          </span>
                        ) : null}
                      </div>
                    )}
                    <p className="text-sm font-medium text-stone-500 leading-relaxed mb-8 border-l-2 border-stone-200 pl-4">{currentOutfit.reason}</p>
                    
                    {!currentOutfit.generatedImageUrl && outfitImageReady && (
                    <Button
                      variant="black"
                      onClick={handleGenerateOutfitImgAction}
                      isLoading={isGeneratingImg}
                      className="h-14 px-8 w-auto"
                    >
                        <Maximize size={16} className="mr-2" /> 
                        <span className="tracking-wide">生成穿搭效果图</span>
                    </Button>
                    )}
                    {!currentOutfit.generatedImageUrl && !outfitImageReady && (
                      <p className="text-xs text-stone-400 leading-relaxed">在 .env 中配置 ARK_API_KEY 后可自动生成穿搭效果图。</p>
                    )}
                    {currentOutfit.generatedImageUrl && outfitImageReady && (
                      <Button
                        variant="secondary"
                        onClick={handleGenerateOutfitImgAction}
                        isLoading={isGeneratingImg}
                        className="h-11 px-6 text-sm"
                      >
                        <RefreshCw size={16} className="mr-2" />
                        重新生成效果图
                      </Button>
                    )}
                </div>
             </div>
             
             <div className="space-y-4 px-2">
               <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] ml-1">Included Items</h3>
               {resolveWardrobeItemsByOutfitIds(currentOutfit.itemIds, items).map(item => (
                 <div key={item.id} className="bg-white p-3 rounded-[20px] shadow-sm border border-stone-50 flex items-center gap-4 active:scale-[0.99] transition-transform" onClick={() => { setSelectedItem(item); setAppState(AppState.ITEM_DETAIL); }}>
                   <div className="w-14 h-14 bg-stone-50 rounded-2xl flex items-center justify-center p-1"><img src={item.imageUrl} className="max-w-full max-h-full object-contain mix-blend-multiply" /></div>
                   <div><p className="font-bold text-sm text-stone-900">{item.name}</p><p className="text-[10px] text-stone-400 uppercase font-bold tracking-wider mt-0.5">{item.category}</p></div>
                 </div>
               ))}
             </div>
           </div>
         </div>
      )}
    </div>
  );
}
