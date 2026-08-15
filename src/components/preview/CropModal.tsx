import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Crop,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useSelectionStore } from "@/stores/selectionStore";
import { useProjectImages } from "@/hooks/useProject";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useFilterStore } from "@/stores/filterStore";
import { useCropStore } from "@/stores/cropStore";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { cropImage, getImageDataUrl, detectFaces, multiCrop, setCropStatus } from "@/lib/tauri";
import type { CropRect } from "@/lib/tauri";
import type { ImageEntry } from "@/types";
import { computeBuckets, BUILTIN_PROFILES } from "@/lib/buckets";
import { selectVisibleImages } from "@/lib/imageFilter";

const HANDLE_SIZE = 14;

type DragMode = "draw" | "move" | "resize";
type ResizeHandle =
  | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface DragState {
  mode: DragMode;
  handle?: ResizeHandle;
  startImgX: number;
  startImgY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
}


export function CropModal() {
  const selectedImage = useSelectionStore((s) => s.selectedImage);
  const setSelectedImage = useSelectionStore((s) => s.setSelectedImage);
  const closeCrop = useUiStore((s) => s.closeCrop);
  const showToast = useUiStore((s) => s.showToast);
  const rootPath = useProjectStore((s) => s.rootPath);
  const queryClient = useQueryClient();
  const { data: allImages = [] } = useProjectImages();

  // Navigate the same filtered + sorted list as the grid
  const showCaptioned = useFilterStore((s) => s.showCaptioned);
  const tagFilter = useFilterStore((s) => s.tagFilter);
  const query = useFilterStore((s) => s.query);
  const ratingFilter = useFilterStore((s) => s.ratingFilter);
  const sortBy = useFilterStore((s) => s.sortBy);
  const sortOrder = useFilterStore((s) => s.sortOrder);
  const cropStatusFilter = useFilterStore((s) => s.cropStatusFilter);
  const images = useMemo(
    () =>
      selectVisibleImages(allImages, {
        showCaptioned,
        tagFilter,
        query,
        ratingFilter,
        sortBy,
        sortOrder,
        cropStatusFilter,
      }),
    [allImages, showCaptioned, tagFilter, query, ratingFilter, sortBy, sortOrder, cropStatusFilter]
  );

  const selectedProfile = useCropStore((s) => s.selectedProfile);
  const setSelectedProfile = useCropStore((s) => s.setSelectedProfile);
  const customProfiles = useCropStore((s) => s.customProfiles);
  const allProfiles = useMemo(() => [...BUILTIN_PROFILES, ...customProfiles], [customProfiles]);
  const buckets = useMemo(() => computeBuckets(selectedProfile), [selectedProfile]);

  const currentIndex = selectedImage
    ? images.findIndex((img) => img.id === selectedImage.id)
    : -1;

  function handlePrev() {
    if (currentIndex > 0) setSelectedImage(images[currentIndex - 1]);
  }

  function handleNext() {
    if (currentIndex < images.length - 1) setSelectedImage(images[currentIndex + 1]);
  }

  function handleNextUncropped() {
    // Find next image without crop_status or with status "uncropped"
    for (let i = currentIndex + 1; i < images.length; i++) {
      const img = images[i];
      if (!img.crop_status || img.crop_status === "uncropped") {
        setSelectedImage(img);
        return;
      }
    }
    // If no uncropped found after current, wrap to beginning
    for (let i = 0; i <= currentIndex; i++) {
      const img = images[i];
      if (!img.crop_status || img.crop_status === "uncropped") {
        setSelectedImage(img);
        return;
      }
    }
  }

  function handleCenterSquare() {
    if (imgWidth <= 0 || imgHeight <= 0) return;
    const size = Math.min(imgWidth, imgHeight);
    const cx = Math.floor((imgWidth - size) / 2);
    const cy = Math.floor((imgHeight - size) / 2);
    setX(cx);
    setY(cy);
    setW(size);
    setH(size);
    setAspectRatio(1);
    setFixed(true);
  }

  const [imgWidth, setImgWidth] = useState(0);
  const [imgHeight, setImgHeight] = useState(0);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [fixed, setFixed] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [rotateDeg, setRotateDeg] = useState(0);
  const [highlight, setHighlight] = useState(true);
  const [saveAsNew, setSaveAsNew] = useState(true);
  const [outputSize, setOutputSize] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [cropMode, setCropMode] = useState<"manual" | "face">("manual");

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const applyAndNextRef = useRef(false);
  const nextImageRef = useRef<typeof images[0] | null>(null);
  const isOpen = useUiStore((s) => s.isCropOpen);
  useFocusTrap(dialogRef, isOpen);

  // The focus trap focuses the first focusable (the header close button);
  // move focus to the Apply button instead. This effect runs after the trap's
  // (it is declared later in the component), so it wins on open.
  useEffect(() => {
    if (isOpen) applyButtonRef.current?.focus();
  }, [isOpen]);

  // Load image via backend (data URL) so it works without asset protocol
  const { data: imageSrc } = useQuery({
    queryKey: ["imageDataUrl", "crop", selectedImage?.path],
    queryFn: () => getImageDataUrl(selectedImage!.path, 2048),
    enabled: isOpen && !!selectedImage?.path,
    staleTime: 2 * 60 * 1000,
  });

  // Face detection query (only runs when face mode is active)
  const { data: faces, isLoading: facesLoading } = useQuery({
    queryKey: ["faces", selectedImage?.path],
    queryFn: () => detectFaces(selectedImage!.path),
    enabled: isOpen && !!selectedImage && cropMode === "face",
    staleTime: Infinity, // cache forever per image
  });

  const detectedFaces = faces ?? [];

  // Latest image size / lock state for the face auto-frame effect, so it does
  // not need those values in its deps (which would re-fire on every manual
  // change and snap the crop back onto the detected face).
  const cropSizeRef = useRef({ imgWidth, imgHeight, fixed, aspectRatio });
  cropSizeRef.current = { imgWidth, imgHeight, fixed, aspectRatio };

  // Auto-frame the largest face (by area) when detection results arrive in
  // face mode: a face-anchored box rather than a no-op recenter of the
  // full-image default rect.
  useEffect(() => {
    if (cropMode !== "face" || !faces || faces.length === 0) return;
    const { imgWidth, imgHeight, fixed, aspectRatio } = cropSizeRef.current;
    if (imgWidth <= 0 || imgHeight <= 0) return;
    const largest = [...faces].sort(
      (a, b) => b.width * b.height - a.width * a.height
    )[0];
    const centerX = largest.x + largest.width / 2;
    const centerY = largest.y + largest.height / 2;
    // Square side: 2.5x the face's larger dimension, clamped to [256, image].
    const side = Math.min(
      Math.max(Math.max(largest.width, largest.height) * 2.5, 256),
      Math.min(imgWidth, imgHeight)
    );
    const cw = Math.max(1, Math.min(Math.round(side), imgWidth));
    const ch = Math.max(
      1,
      Math.min(
        Math.round(fixed && aspectRatio != null ? side / aspectRatio : side),
        imgHeight
      )
    );
    const nx = Math.max(0, Math.min(imgWidth - cw, Math.round(centerX - cw / 2)));
    const ny = Math.max(0, Math.min(imgHeight - ch, Math.round(centerY - ch / 2)));
    setX(nx);
    setY(ny);
    setW(cw);
    setH(ch);
  }, [faces, selectedImage?.path, cropMode]);

  // Reset state and set dimensions from entry when opening (use original image dimensions for crop)
  useEffect(() => {
    if (isOpen && selectedImage) {
      setFlipX(false);
      setFlipY(false);
      setRotateDeg(0);
      setAspectRatio(null);
      setOutputSize(null);
      const ow = selectedImage.width ?? 0;
      const oh = selectedImage.height ?? 0;
      setImgWidth(ow);
      setImgHeight(oh);
      setX(0);
      setY(0);
      setW(ow);
      setH(oh);
    }
  }, [isOpen, selectedImage]);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // If we didn't have dimensions from entry, use loaded image size
    setImgWidth((prev) => (prev > 0 ? prev : img.naturalWidth));
    setImgHeight((prev) => (prev > 0 ? prev : img.naturalHeight));
    setW((prev) => (prev > 0 ? prev : img.naturalWidth));
    setH((prev) => (prev > 0 ? prev : img.naturalHeight));
  }, []);

  // --- Flip-aware coordinate mapping -------------------------------------
  // The crop rect (x, y, w, h) is stored in ORIGINAL image coordinates: the
  // backend crops the original first and applies flips/rotation afterwards.
  // The preview <img> is rendered with CSS scaleX(-1)/scaleY(-1) when flipped,
  // so all pointer interaction and overlay drawing happen in DISPLAY space
  // (what the user sees) and are converted at the boundary:
  //   display dx = flipX ? imgWidth  - x - w : x
  //   display dy = flipY ? imgHeight - y - h : y
  // (and the same formula converts back, since it is its own inverse).
  // A rect framed over a feature in the mirrored preview therefore saves the
  // original-space rect that contains that feature once the backend flip runs.
  const toDisplayX = useCallback(
    (ox: number, ow: number) => (flipX ? imgWidth - ox - ow : ox),
    [flipX, imgWidth]
  );
  const toDisplayY = useCallback(
    (oy: number, oh: number) => (flipY ? imgHeight - oy - oh : oy),
    [flipY, imgHeight]
  );

  // Convert screen (clientX, clientY) to display-space image coordinates
  const screenToImage = useCallback(
    (clientX: number, clientY: number): { imgX: number; imgY: number } | null => {
      const el = imageContainerRef.current;
      if (!el || imgWidth <= 0 || imgHeight <= 0) return null;
      const rect = el.getBoundingClientRect();
      const scaleX = rect.width / imgWidth;
      const scaleY = rect.height / imgHeight;
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const imgX = Math.max(0, Math.min(imgWidth, relX / scaleX));
      const imgY = Math.max(0, Math.min(imgHeight, relY / scaleY));
      return { imgX, imgY };
    },
    [imgWidth, imgHeight]
  );

  // Get crop rect in screen coordinates for hit-testing (display space, i.e.
  // mirrored to match the flipped preview).
  const getCropScreenRect = useCallback(() => {
    const el = imageContainerRef.current;
    if (!el || imgWidth <= 0 || imgHeight <= 0) return null;
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width / imgWidth;
    const scaleY = rect.height / imgHeight;
    const dx = toDisplayX(x, w);
    const dy = toDisplayY(y, h);
    return {
      left: rect.left + dx * scaleX,
      top: rect.top + dy * scaleY,
      right: rect.left + (dx + w) * scaleX,
      bottom: rect.top + (dy + h) * scaleY,
      width: w * scaleX,
      height: h * scaleY,
    };
  }, [imgWidth, imgHeight, x, y, w, h, toDisplayX, toDisplayY]);

  const hitTestHandle = useCallback(
    (clientX: number, clientY: number): ResizeHandle | null => {
      const sr = getCropScreenRect();
      if (!sr) return null;
      const near = (px: number, py: number, hx: number, hy: number) =>
        Math.hypot(px - hx, py - hy) <= HANDLE_SIZE;
      const { left, top, right, bottom, width, height } = sr;
      const cx = left + width / 2;
      const cy = top + height / 2;
      if (near(clientX, clientY, left, top)) return "nw";
      if (near(clientX, clientY, right, top)) return "ne";
      if (near(clientX, clientY, right, bottom)) return "se";
      if (near(clientX, clientY, left, bottom)) return "sw";
      if (near(clientX, clientY, cx, top)) return "n";
      if (near(clientX, clientY, right, cy)) return "e";
      if (near(clientX, clientY, cx, bottom)) return "s";
      if (near(clientX, clientY, left, cy)) return "w";
      return null;
    },
    [getCropScreenRect]
  );

  const isInsideCrop = useCallback(
    (clientX: number, clientY: number): boolean => {
      const sr = getCropScreenRect();
      if (!sr) return false;
      return (
        clientX >= sr.left &&
        clientX <= sr.right &&
        clientY >= sr.top &&
        clientY <= sr.bottom
      );
    },
    [getCropScreenRect]
  );

  // Takes a rect in DISPLAY space, clamps it to the image, and stores it in
  // ORIGINAL space (mirrored back through the active flips).
  const applyCropFromInteraction = useCallback(
    (newX: number, newY: number, newW: number, newH: number) => {
      const dx = Math.max(0, Math.min(imgWidth - 1, Math.round(newX)));
      const dy = Math.max(0, Math.min(imgHeight - 1, Math.round(newY)));
      const nw = Math.max(1, Math.min(imgWidth - dx, Math.round(newW)));
      const nh = Math.max(1, Math.min(imgHeight - dy, Math.round(newH)));
      setX(flipX ? imgWidth - dx - nw : dx);
      setY(flipY ? imgHeight - dy - nh : dy);
      setW(nw);
      setH(nh);
    },
    [imgWidth, imgHeight, flipX, flipY]
  );

  const handleImageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (imgWidth <= 0 || imgHeight <= 0) return;
      const coords = screenToImage(e.clientX, e.clientY);
      if (!coords) return;
      const target = e.currentTarget as HTMLElement;
      if ("setPointerCapture" in target && "pointerId" in e.nativeEvent)
        target.setPointerCapture((e.nativeEvent as PointerEvent).pointerId);
      const { imgX, imgY } = coords;
      // Drag state lives in display space; converted back on apply.
      const dispX = toDisplayX(x, w);
      const dispY = toDisplayY(y, h);
      const handle = hitTestHandle(e.clientX, e.clientY);
      if (handle) {
        setDragState({
          mode: "resize",
          handle,
          startImgX: imgX,
          startImgY: imgY,
          startX: dispX,
          startY: dispY,
          startW: w,
          startH: h,
        });
      } else if (isInsideCrop(e.clientX, e.clientY)) {
        setDragState({
          mode: "move",
          startImgX: imgX,
          startImgY: imgY,
          startX: dispX,
          startY: dispY,
          startW: w,
          startH: h,
        });
      } else {
        setDragState({
          mode: "draw",
          startImgX: imgX,
          startImgY: imgY,
          startX: imgX,
          startY: imgY,
          startW: 0,
          startH: 0,
        });
      }
    },
    [
      imgWidth,
      imgHeight,
      screenToImage,
      hitTestHandle,
      isInsideCrop,
      toDisplayX,
      toDisplayY,
      x,
      y,
      w,
      h,
    ]
  );

  const handleImageMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragState) return;
      const coords = screenToImage(e.clientX, e.clientY);
      if (!coords) return;
      const { imgX, imgY } = coords;
      const { mode, handle, startImgX, startImgY, startX, startY, startW, startH } =
        dragState;

      // Effective locked ratio for draw/resize. When Lock Ratio is on without
      // an explicit ratio, lock to the rect's ratio at drag start (1:1 when
      // drawing a fresh rect).
      const lockedRatio = fixed
        ? aspectRatio ??
          (mode !== "draw" && startH > 0 ? startW / startH : 1)
        : null;

      if (mode === "draw") {
        if (lockedRatio != null && lockedRatio > 0) {
          // Ratio-locked draw: anchor at the drag origin, grow toward the
          // pointer, keep w/h = ratio, shrink to fit the image bounds.
          const r = lockedRatio;
          const sx = imgX >= startImgX ? 1 : -1;
          const sy = imgY >= startImgY ? 1 : -1;
          const rawW = Math.abs(imgX - startImgX);
          const rawH = Math.abs(imgY - startImgY);
          const maxW = Math.min(
            sx > 0 ? imgWidth - startImgX : startImgX,
            (sy > 0 ? imgHeight - startImgY : startImgY) * r
          );
          const nw = Math.max(
            1,
            Math.min(Math.max(rawW, rawH * r), Math.max(1, maxW))
          );
          const nh = nw / r;
          const nx = sx > 0 ? startImgX : startImgX - nw;
          const ny = sy > 0 ? startImgY : startImgY - nh;
          applyCropFromInteraction(nx, ny, nw, nh);
        } else {
          const nx = Math.min(startImgX, imgX);
          const ny = Math.min(startImgY, imgY);
          const nw = Math.max(1, Math.abs(imgX - startImgX));
          const nh = Math.max(1, Math.abs(imgY - startImgY));
          applyCropFromInteraction(nx, ny, nw, nh);
        }
      } else if (mode === "move") {
        const dx = imgX - startImgX;
        const dy = imgY - startImgY;
        let nx = startX + dx;
        let ny = startY + dy;
        nx = Math.max(0, Math.min(imgWidth - startW, nx));
        ny = Math.max(0, Math.min(imgHeight - startH, ny));
        applyCropFromInteraction(nx, ny, startW, startH);
      } else if (mode === "resize" && handle) {
        if (lockedRatio != null && lockedRatio > 0) {
          // Ratio-locked resize: anchor at the opposite corner/edge, derive
          // both dims from the pointer, clamp to bounds preserving the ratio.
          const r = lockedRatio;
          let nx: number, ny: number, nw: number, nh: number;
          switch (handle) {
            case "se": {
              const ax = startX;
              const ay = startY;
              const maxW = Math.min(imgWidth - ax, (imgHeight - ay) * r);
              nw = Math.min(Math.max(1, Math.max(imgX - ax, (imgY - ay) * r)), Math.max(1, maxW));
              nh = nw / r;
              nx = ax;
              ny = ay;
              break;
            }
            case "ne": {
              const ax = startX;
              const ay = startY + startH;
              const maxW = Math.min(imgWidth - ax, ay * r);
              nw = Math.min(Math.max(1, Math.max(imgX - ax, (ay - imgY) * r)), Math.max(1, maxW));
              nh = nw / r;
              nx = ax;
              ny = ay - nh;
              break;
            }
            case "sw": {
              const ax = startX + startW;
              const ay = startY;
              const maxW = Math.min(ax, (imgHeight - ay) * r);
              nw = Math.min(Math.max(1, Math.max(ax - imgX, (imgY - ay) * r)), Math.max(1, maxW));
              nh = nw / r;
              nx = ax - nw;
              ny = ay;
              break;
            }
            case "nw": {
              const ax = startX + startW;
              const ay = startY + startH;
              const maxW = Math.min(ax, ay * r);
              nw = Math.min(Math.max(1, Math.max(ax - imgX, (ay - imgY) * r)), Math.max(1, maxW));
              nh = nw / r;
              nx = ax - nw;
              ny = ay - nh;
              break;
            }
            case "e": {
              const maxW = Math.min(imgWidth - startX, (imgHeight - startY) * r);
              nw = Math.min(Math.max(1, imgX - startX), Math.max(1, maxW));
              nh = nw / r;
              nx = startX;
              ny = startY;
              break;
            }
            case "w": {
              const ax = startX + startW;
              const maxW = Math.min(ax, (imgHeight - startY) * r);
              nw = Math.min(Math.max(1, ax - imgX), Math.max(1, maxW));
              nh = nw / r;
              nx = ax - nw;
              ny = startY;
              break;
            }
            case "s": {
              const maxH = Math.min(imgHeight - startY, (imgWidth - startX) / r);
              nh = Math.min(Math.max(1, imgY - startY), Math.max(1, maxH));
              nw = nh * r;
              nx = startX;
              ny = startY;
              break;
            }
            case "n": {
              const ay = startY + startH;
              const maxH = Math.min(ay, (imgWidth - startX) / r);
              nh = Math.min(Math.max(1, ay - imgY), Math.max(1, maxH));
              nw = nh * r;
              nx = startX;
              ny = ay - nh;
              break;
            }
            default:
              return;
          }
          applyCropFromInteraction(nx, ny, nw, nh);
          return;
        }
        let nx: number, ny: number, nw: number, nh: number;
        switch (handle) {
            case "nw":
              nx = imgX;
              ny = imgY;
              nw = startX + startW - imgX;
              nh = startY + startH - imgY;
              break;
            case "n":
              nx = startX;
              ny = imgY;
              nw = startW;
              nh = startY + startH - imgY;
              break;
            case "ne":
              nx = startX;
              ny = imgY;
              nw = imgX - startX;
              nh = startY + startH - imgY;
              break;
            case "e":
              nx = startX;
              ny = startY;
              nw = imgX - startX;
              nh = startH;
              break;
            case "se":
              nx = startX;
              ny = startY;
              nw = imgX - startX;
              nh = imgY - startY;
              break;
            case "s":
              nx = startX;
              ny = startY;
              nw = startW;
              nh = imgY - startY;
              break;
            case "sw":
              nx = imgX;
              ny = startY;
              nw = startX + startW - imgX;
              nh = imgY - startY;
              break;
            case "w":
              nx = imgX;
              ny = startY;
              nw = startX + startW - imgX;
              nh = startH;
              break;
            default:
              return;
          }
        // Clamp to image and enforce min size
        nw = Math.max(1, nw);
        nh = Math.max(1, nh);
        if (nx < 0) {
          nw += nx;
          nx = 0;
        }
        if (ny < 0) {
          nh += ny;
          ny = 0;
        }
        if (nx + nw > imgWidth) nw = imgWidth - nx;
        if (ny + nh > imgHeight) nh = imgHeight - ny;
        nw = Math.max(1, nw);
        nh = Math.max(1, nh);
        applyCropFromInteraction(nx, ny, nw, nh);
      }
    },
    [
      dragState,
      screenToImage,
      applyCropFromInteraction,
      imgWidth,
      imgHeight,
      fixed,
      aspectRatio,
    ]
  );

  const handleImageMouseUp = useCallback((e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    if ("releasePointerCapture" in el && "pointerId" in e.nativeEvent)
      el.releasePointerCapture((e.nativeEvent as PointerEvent).pointerId);
    setDragState(null);
  }, []);

  const handleImageMouseLeave = useCallback(() => {
    setDragState(null);
  }, []);

  // End drag when mouse is released anywhere (e.g. outside the image)
  useEffect(() => {
    if (!dragState) return;
    const onWindowMouseUp = () => setDragState(null);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, [dragState]);

  const applyAspectRatio = useCallback(
    (ratio: number, anchor: "w" | "h") => {
      if (anchor === "w") {
        const newH = Math.round(w / ratio);
        setH(Math.max(1, Math.min(newH, imgHeight)));
        if (y + Math.min(newH, imgHeight) > imgHeight) {
          setY(Math.max(0, imgHeight - Math.min(newH, imgHeight)));
        }
      } else {
        const newW = Math.round(h * ratio);
        setW(Math.max(1, Math.min(newW, imgWidth)));
        if (x + Math.min(newW, imgWidth) > imgWidth) {
          setX(Math.max(0, imgWidth - Math.min(newW, imgWidth)));
        }
      }
    },
    [w, h, x, y, imgWidth, imgHeight]
  );

  const handleWChange = (newW: number) => {
    const nw = Math.max(1, Math.min(newW, imgWidth - x));
    setW(nw);
    if (fixed && aspectRatio != null) {
      const newH = Math.round(nw / aspectRatio);
      setH(Math.max(1, Math.min(newH, imgHeight - y)));
    }
  };

  const handleHChange = (newH: number) => {
    const nh = Math.max(1, Math.min(newH, imgHeight - y));
    setH(nh);
    if (fixed && aspectRatio != null) {
      const newW = Math.round(nh * aspectRatio);
      setW(Math.max(1, Math.min(newW, imgWidth - x)));
    }
  };

  const invalidateProject = useCallback(() => {
    if (rootPath) {
      queryClient.invalidateQueries({ queryKey: ["project", "images", rootPath] });
    }
  }, [queryClient, rootPath]);

  // Drop cached thumbnails (any size) and preview data URLs for an image so
  // views refetch fresh pixels after a crop touches the file on disk.
  const invalidateImageArtifacts = useCallback(
    (imagePath: string) => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey;
          return (
            (key[0] === "thumbnail" && key[1] === imagePath) ||
            (key[0] === "imageDataUrl" && key.includes(imagePath))
          );
        },
      });
    },
    [queryClient]
  );

  const cropMutation = useMutation({
    mutationFn: () =>
      cropImage({
        image_path: selectedImage!.path,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(w)),
        height: Math.max(1, Math.round(h)),
        flip_x: flipX,
        flip_y: flipY,
        rotate_degrees: rotateDeg,
        save_as_new: saveAsNew,
        output_size: outputSize ?? undefined,
      }),
    onSuccess: async () => {
      // Mark as cropped (must not block closing the modal if the write fails)
      if (rootPath && selectedImage) {
        try {
          await setCropStatus(rootPath, selectedImage.relative_path, "cropped");
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err));
        }
      }
      if (selectedImage) {
        invalidateImageArtifacts(selectedImage.path);
        if (!saveAsNew && rootPath) {
          // Overwrite crop changed the file's real dimensions: clear the
          // cached ones so the dimension-backfill effect refetches them.
          queryClient.setQueryData<ImageEntry[]>(
            ["project", "images", rootPath],
            (old) =>
              old?.map((img) =>
                img.path === selectedImage.path
                  ? { ...img, width: undefined, height: undefined }
                  : img
              )
          );
        }
      }
      invalidateProject();
      if (applyAndNextRef.current) {
        applyAndNextRef.current = false;
        const next = nextImageRef.current;
        nextImageRef.current = null;
        if (next) setSelectedImage(next);
        else closeCrop();
      } else {
        closeCrop();
      }
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : String(err));
    },
  });

  // Arrow keys: prev/next; Ctrl+Enter: apply and next; S: 1:1 aspect.
  // Latest handlers/values live in a ref so the listener never acts on a stale closure.
  const keydownRef = useRef({
    handlePrev,
    handleNext,
    applyAspectRatio,
    currentIndex,
    images,
    w,
    h,
    cropMutation,
    closeCrop,
  });
  keydownRef.current = {
    handlePrev,
    handleNext,
    applyAspectRatio,
    currentIndex,
    images,
    w,
    h,
    cropMutation,
    closeCrop,
  };

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      const { handlePrev, handleNext, applyAspectRatio, currentIndex, images, w, h, cropMutation, closeCrop } =
        keydownRef.current;
      if (e.key === "Escape") {
        // Close only the crop modal; stop propagation (listener is in the
        // capture phase) so the preview modal underneath stays open.
        e.preventDefault();
        e.stopPropagation();
        closeCrop();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (cropMutation.isPending) return;
        applyAndNextRef.current = true;
        nextImageRef.current =
          currentIndex < images.length - 1 ? images[currentIndex + 1]! : null;
        cropMutation.mutate();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setAspectRatio(1);
        setFixed(true);
        applyAspectRatio(1, w >= h ? "w" : "h");
      }
    }
    // Capture phase: runs before (and can suppress) the preview modal's and
    // grid's bubble-phase window listeners for the same keydown.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen]);

  const multiCropMutation = useMutation({
    mutationFn: () => {
      // Generate 3 crop regions: full, medium (cowboy), close-up
      const crops: CropRect[] = [];
      
      // Full body: current crop region
      crops.push({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(w)),
        height: Math.max(1, Math.round(h)),
        suffix: "_full",
      });
      
      // Medium (cowboy shot): upper 60% of crop
      const medHeight = Math.round(h * 0.6);
      crops.push({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(w)),
        height: Math.max(1, medHeight),
        suffix: "_med",
      });
      
      // Close-up: center 40% of crop
      const closeSize = Math.round(Math.min(w, h) * 0.4);
      const closeX = Math.round(x + (w - closeSize) / 2);
      const closeY = Math.round(y + (h - closeSize) / 3); // slightly higher for face
      crops.push({
        x: closeX,
        y: closeY,
        width: Math.max(1, closeSize),
        height: Math.max(1, closeSize),
        suffix: "_close",
      });
      
      return multiCrop({
        image_path: selectedImage!.path,
        crops,
        flip_x: flipX,
        flip_y: flipY,
        rotate_degrees: rotateDeg,
        output_size: outputSize ?? undefined,
      });
    },
    onSuccess: async () => {
      // Mark as multi-cropped (must not block closing the modal if the write fails)
      if (rootPath && selectedImage) {
        try {
          await setCropStatus(rootPath, selectedImage.relative_path, "multi");
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err));
        }
      }
      if (selectedImage) invalidateImageArtifacts(selectedImage.path);
      invalidateProject();
      closeCrop();
    },
    onError: (err) => {
      showToast(err instanceof Error ? err.message : String(err));
    },
  });

  if (!isOpen || !selectedImage) return null;

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[60] flex flex-col bg-black/90">
      <div className="flex items-center justify-between border-b border-border bg-surface-elevated/95 px-4 py-2">
        <h2 className="flex items-center gap-2 text-lg font-medium text-gray-100">
          <Crop className="h-5 w-5" />
          Crop image
        </h2>
        <button
          type="button"
          onClick={closeCrop}
          className="rounded p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Image area + nav bar under image */}
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Crop mode selector */}
          <div className="flex gap-2 border-b border-border bg-surface-elevated/95 px-4 py-2">
            <button
              type="button"
              onClick={() => setCropMode("manual")}
              className={`px-3 py-1 text-sm rounded ${
                cropMode === "manual"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => setCropMode("face")}
              className={`px-3 py-1 text-sm rounded ${
                cropMode === "face"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              Face Detect {facesLoading && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-auto bg-gray-900 p-4">
          {imageSrc && (
            <div
              ref={imageContainerRef}
              role="img"
              aria-label="Crop area"
              className={`relative inline-block max-h-full max-w-full select-none ${
                dragState?.mode === "move" ? "cursor-grabbing" : "cursor-crosshair"
              }`}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseUp={handleImageMouseUp}
              onMouseLeave={handleImageMouseLeave}
            >
              <img
                src={imageSrc}
                alt=""
                className="max-h-[70vh] w-auto"
                onLoad={onImageLoad}
                draggable={false}
                style={{
                  // Rotation is intentionally NOT previewed live (a CSS rotate
                  // overflows the container and breaks coordinate mapping);
                  // it is applied on save. Flips are previewed, with the crop
                  // overlay and pointer mapping mirrored to match.
                  transform: [
                    flipX ? "scaleX(-1)" : "",
                    flipY ? "scaleY(-1)" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
                }}
              />
              {highlight && imgWidth > 0 && imgHeight > 0 && (
                <>
                  <div
                    className="pointer-events-none absolute border-2 border-white/80 bg-black/30"
                    style={{
                      left: `${(toDisplayX(x, w) / imgWidth) * 100}%`,
                      top: `${(toDisplayY(y, h) / imgHeight) * 100}%`,
                      width: `${(w / imgWidth) * 100}%`,
                      height: `${(h / imgHeight) * 100}%`,
                    }}
                  />
                  {/* Resize handles (visual only; hit-testing is by position on container) */}
                  {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(
                    (handle) => {
                      const dispX = toDisplayX(x, w);
                      const dispY = toDisplayY(y, h);
                      const leftPct = (dispX / imgWidth) * 100;
                      const topPct = (dispY / imgHeight) * 100;
                      const rightPct = ((dispX + w) / imgWidth) * 100;
                      const bottomPct = ((dispY + h) / imgHeight) * 100;
                      const cx = (leftPct + rightPct) / 2;
                      const cy = (topPct + bottomPct) / 2;
                      let style: React.CSSProperties = {};
                      const size = 10;
                      if (handle === "nw")
                        style = { left: `${leftPct}%`, top: `${topPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "n")
                        style = { left: `${cx}%`, top: `${topPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "ne")
                        style = { left: `${rightPct}%`, top: `${topPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "e")
                        style = { left: `${rightPct}%`, top: `${cy}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "se")
                        style = { left: `${rightPct}%`, top: `${bottomPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "s")
                        style = { left: `${cx}%`, top: `${bottomPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "sw")
                        style = { left: `${leftPct}%`, top: `${bottomPct}%`, transform: "translate(-50%, -50%)" };
                      else if (handle === "w")
                        style = { left: `${leftPct}%`, top: `${cy}%`, transform: "translate(-50%, -50%)" };
                      return (
                        <div
                          key={handle}
                          className="pointer-events-none absolute rounded-full border-2 border-white bg-white/20"
                          style={{
                            ...style,
                            width: size,
                            height: size,
                          }}
                        />
                      );
                    }
                  )}
                </>
              )}
              {/* Face detection overlays */}
              {cropMode === "face" && detectedFaces.length > 0 && imgWidth > 0 && imgHeight > 0 && (
                <>
                  {detectedFaces.map((face, idx) => (
                    <div
                      key={idx}
                      className="pointer-events-none absolute border-2 border-green-400 bg-green-400/10"
                      style={{
                        // Faces are detected in original coordinates; mirror
                        // them to land on the flipped preview.
                        left: `${(toDisplayX(face.x, face.width) / imgWidth) * 100}%`,
                        top: `${(toDisplayY(face.y, face.height) / imgHeight) * 100}%`,
                        width: `${(face.width / imgWidth) * 100}%`,
                        height: `${(face.height / imgHeight) * 100}%`,
                      }}
                    >
                      <div className="absolute -top-5 left-0 text-xs text-green-400 bg-black/70 px-1 rounded">
                        Face {idx + 1} ({Math.round(face.confidence * 100)}%)
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          </div>
          {/* Prev/next under image */}
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border bg-surface-elevated/95 px-4 py-3">
            <button
              type="button"
              onClick={handlePrev}
              disabled={currentIndex <= 0}
              className="rounded-lg border border-border bg-surface-elevated/90 p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30"
              title="Previous image (←)"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="min-w-[4rem] text-center text-sm text-gray-400">
              {currentIndex + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={currentIndex >= images.length - 1}
              className="rounded-lg border border-border bg-surface-elevated/90 p-2 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-30"
              title="Next image (→)"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleNextUncropped}
              className="ml-2 rounded border border-blue-600 bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-200 hover:bg-blue-600/30"
              title="Jump to next uncropped image"
            >
              Next Uncropped
            </button>
          </div>
        </div>

        {/* Controls panel */}
        <div className="w-80 shrink-0 space-y-4 overflow-auto border-l border-border bg-surface-elevated p-4">
          <div className="text-sm font-medium text-gray-400">Size and position</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">W (px)</label>
              <input
                type="number"
                min={1}
                max={imgWidth}
                value={w || ""}
                onChange={(e) => handleWChange(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">H (px)</label>
              <input
                type="number"
                min={1}
                max={imgHeight}
                value={h || ""}
                onChange={(e) => handleHChange(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">X (px)</label>
              <input
                type="number"
                min={0}
                max={imgWidth - 1}
                value={x}
                onChange={(e) => setX(Math.max(0, Math.min(imgWidth - w, parseInt(e.target.value, 10) || 0)))}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Y (px)</label>
              <input
                type="number"
                min={0}
                max={imgHeight - 1}
                value={y}
                onChange={(e) => setY(Math.max(0, Math.min(imgHeight - h, parseInt(e.target.value, 10) || 0)))}
                className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
              />
            </div>
          </div>

          <div className="text-sm font-medium text-gray-400">Options</div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fixed}
                onChange={(e) => setFixed(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Lock Ratio</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={highlight}
                onChange={(e) => setHighlight(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Highlight</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={saveAsNew}
                onChange={(e) => setSaveAsNew(e.target.checked)}
                className="rounded border-gray-600"
              />
              <span className="text-sm text-gray-300">Save as new image (keep original)</span>
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Trainer Profile</label>
            <select
              value={selectedProfile.id}
              onChange={(e) => {
                const profile = allProfiles.find((p) => p.id === e.target.value);
                if (profile) setSelectedProfile(profile);
              }}
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
            >
              {allProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={handleCenterSquare}
              disabled={imgWidth <= 0 || imgHeight <= 0}
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
            >
              Center square
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Output Resize</label>
            <select
              value={outputSize ?? ""}
              onChange={(e) =>
                setOutputSize(e.target.value === "" ? null : Number(e.target.value))
              }
              className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">Native crop size (no resize)</option>
              <option value={512}>Resize to 512×512</option>
              <option value={768}>Resize to 768×768</option>
              <option value={1024}>Resize to 1024×1024</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Applied after cropping. Trainer may resize again.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">
              Bucket Ratios ({selectedProfile.name})
            </label>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {buckets.map((bucket) => (
                <button
                  key={`${bucket.width}x${bucket.height}`}
                  type="button"
                  onClick={() => {
                    setW(bucket.width);
                    setH(bucket.height);
                    setAspectRatio(bucket.ratio);
                    setFixed(true);
                    setX(Math.max(0, Math.floor((imgWidth - bucket.width) / 2)));
                    setY(Math.max(0, Math.floor((imgHeight - bucket.height) / 2)));
                  }}
                  className={`rounded px-2 py-1 text-xs ${
                    w === bucket.width && h === bucket.height
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                  title={`${bucket.width} × ${bucket.height}`}
                >
                  {bucket.label}
                </button>
              ))}
            </div>
          </div>


          <div className="text-sm font-medium text-gray-400">Transform</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRotateDeg((r) => (r + 90) % 360)}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
                rotateDeg !== 0
                  ? "border-blue-500 bg-blue-600/20 text-blue-300"
                  : "border-border bg-surface text-gray-200 hover:bg-gray-700"
              }`}
            >
              <RotateCw className="h-4 w-4" />
              Rotate 90°{rotateDeg !== 0 ? ` (${rotateDeg}°)` : ""}
            </button>
            {rotateDeg !== 0 && (
              <span className="flex items-center rounded bg-blue-600/20 px-2 py-1 text-xs text-blue-200">
                Rotation is applied on save
              </span>
            )}
            <button
              type="button"
              onClick={() => setFlipX((f) => !f)}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
                flipX ? "border-blue-500 bg-blue-600/20 text-blue-300" : "border-border bg-surface text-gray-200 hover:bg-gray-700"
              }`}
            >
              <FlipHorizontal className="h-4 w-4" />
              Flip X
            </button>
            <button
              type="button"
              onClick={() => setFlipY((f) => !f)}
              className={`flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
                flipY ? "border-blue-500 bg-blue-600/20 text-blue-300" : "border-border bg-surface text-gray-200 hover:bg-gray-700"
              }`}
            >
              <FlipVertical className="h-4 w-4" />
              Flip Y
            </button>
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <button
              ref={applyButtonRef}
              type="button"
              onClick={() => cropMutation.mutate()}
              disabled={!w || !h || cropMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              title="Ctrl+Enter: apply and go to next image"
            >
              {cropMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crop className="h-4 w-4" />
              )}
              {saveAsNew ? "Crop to new image (safe)" : "Crop selection (⚠️ overwrite)"}
            </button>
            <button
              type="button"
              onClick={() => {
                applyAndNextRef.current = true;
                nextImageRef.current =
                  currentIndex < images.length - 1 ? images[currentIndex + 1]! : null;
                cropMutation.mutate();
              }}
              disabled={!w || !h || cropMutation.isPending || currentIndex >= images.length - 1}
              className="flex w-full items-center justify-center gap-2 rounded border border-border bg-surface px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              title="Ctrl+Enter"
            >
              Apply and next
            </button>
            <button
              type="button"
              onClick={() => multiCropMutation.mutate()}
              disabled={!w || !h || multiCropMutation.isPending}
              className="flex w-full items-center justify-center gap-2 rounded border border-purple-600 bg-purple-600/20 px-4 py-2 text-sm font-medium text-purple-200 hover:bg-purple-600/30 disabled:opacity-50"
              title="Generate 3 crops: full, medium, close-up"
            >
              {multiCropMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crop className="h-4 w-4" />
              )}
              Multi-Crop (3 stages)
            </button>
            {cropMutation.isError && (
              <p className="text-xs text-red-400" role="alert">
                {cropMutation.error instanceof Error
                  ? cropMutation.error.message
                  : String(cropMutation.error)}
              </p>
            )}
            {multiCropMutation.isError && (
              <p className="text-xs text-red-400" role="alert">
                {multiCropMutation.error instanceof Error
                  ? multiCropMutation.error.message
                  : String(multiCropMutation.error)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
