import { useRef } from 'react';
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { SortableImageItem } from './SortableImageItem';
import { useImageUpload } from './useImageUpload';
import type { ImageItem } from './types';

interface ImageThumbnailBarProps {
  nodeId: string;
  images: ImageItem[];
  onChange: (images: ImageItem[]) => void;
  onImageClick: (imageId: string) => void;
  onImageUploaded: (imageId: string) => void;
  onBeforeImageDelete?: (imageId: string) => void;
  maxCount?: number;
  disabled?: boolean;
}

export function ImageThumbnailBar({
  nodeId,
  images,
  onChange,
  onImageClick,
  onImageUploaded,
  onBeforeImageDelete,
  maxCount = 9,
  disabled = false,
}: ImageThumbnailBarProps) {
  const { uploadBatchImages, deleteImage } = useImageUpload(nodeId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = images.findIndex((img) => img.id === active.id);
    const newIdx = images.findIndex((img) => img.id === over.id);

    if (oldIdx === -1 || newIdx === -1) return;

    onChange(arrayMove(images, oldIdx, newIdx));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const processUpload = async (files: File[]) => {
    const uploaded = await uploadBatchImages(files, maxCount);
    if (uploaded.length === 0) return;
    onChange([...images, ...uploaded]);
    uploaded.forEach((img) => onImageUploaded(img.id));
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length === 0) return;
    await processUpload(Array.from(e.dataTransfer.files));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await processUpload(Array.from(e.target.files));
  };

  const handleDeleteImage = (imageId: string) => {
    onBeforeImageDelete?.(imageId);
    deleteImage(imageId);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const showUploadButton = !disabled && images.length < maxCount;

  return (
    <div
      data-testid="thumbnail-bar"
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' as any }}
      onDragOver={disabled ? undefined : handleDragOver}
      onDrop={disabled ? undefined : handleDrop}
    >
      {/* 风格按钮 — 仅外观无功能（spec 需求4 拍板；点击无反应是预期，登记 §7-4）。图标：§9-S1 用户提供的调色盘 SVG，fill=currentColor（#9C9C9C 随文字色，零硬编码 hex） */}
      <button
        type="button"
        aria-label="风格"
        className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-overlay-2 transition-colors hover:bg-overlay-3"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M9.99984 1.6665C12.8963 1.66657 15.2495 4.01987 15.2497 6.91634C15.2497 7.36772 15.1905 7.80796 15.0828 8.22738C16.9864 9.01336 18.3331 10.8969 18.3332 13.0833C18.333 15.9797 15.9797 18.3331 13.0833 18.3332C11.9296 18.3332 10.8642 17.9594 9.99902 17.3249C9.13414 17.9591 8.06974 18.3332 6.91634 18.3332C4.01994 18.3331 1.66671 15.9797 1.6665 13.0833C1.66658 10.8973 3.01295 9.01441 4.91602 8.22819C4.80822 7.80859 4.75 7.36794 4.75 6.91634C4.75013 4.01987 7.10336 1.66657 9.99984 1.6665ZM5.37012 9.39355C3.93285 9.99793 2.91658 11.4282 2.9165 13.0833C2.91671 15.2894 4.7103 17.0831 6.91634 17.0832C7.94279 17.0832 8.87371 16.6973 9.57992 16.0578L9.58561 16.0537C10.4037 15.3286 10.9161 14.2632 10.9162 13.0833C10.9162 12.7459 10.8732 12.4174 10.7949 12.1051C10.7909 12.1057 10.7867 12.1054 10.7827 12.106C10.7292 12.1139 10.6756 12.1216 10.6216 12.1279C10.5439 12.1373 10.4657 12.1447 10.3872 12.1507C10.3571 12.1529 10.3271 12.1548 10.2969 12.1564C10.1985 12.1623 10.0994 12.167 9.99984 12.167C9.52286 12.167 9.057 12.1065 8.61312 11.9823C8.42825 11.9316 8.24801 11.8688 8.07194 11.7992C8.05882 11.794 8.04595 11.7882 8.03288 11.7829C7.95666 11.752 7.88102 11.7203 7.80664 11.686C7.79727 11.6817 7.78831 11.6766 7.77897 11.6722C7.70564 11.6379 7.63311 11.6023 7.56169 11.5648C7.5404 11.5536 7.51932 11.5421 7.49821 11.5306C7.44039 11.4992 7.38298 11.4672 7.3265 11.4338C7.29714 11.4164 7.2684 11.398 7.23942 11.38C7.18979 11.3493 7.14063 11.318 7.09212 11.2856C7.06449 11.2672 7.03719 11.2484 7.00993 11.2295C6.96295 11.1969 6.91661 11.1635 6.87077 11.1294C6.83687 11.1042 6.80312 11.0789 6.76986 11.0529C6.73639 11.0267 6.70338 11.0001 6.67057 10.9731C6.63082 10.9405 6.59133 10.9076 6.55257 10.8739C6.5165 10.8424 6.48115 10.8102 6.44596 10.7778C6.41531 10.7496 6.38479 10.7213 6.35482 10.6924C6.32265 10.6613 6.29097 10.6298 6.2596 10.598C6.22809 10.566 6.1967 10.5339 6.16602 10.5011C6.13189 10.4647 6.099 10.4271 6.06592 10.3896C6.03791 10.358 6.00934 10.3268 5.9821 10.2944C5.95563 10.263 5.93052 10.2305 5.90479 10.1984C5.87251 10.1582 5.83986 10.1183 5.80876 10.0771C5.78371 10.044 5.75979 10.01 5.73551 9.97624C5.70687 9.93641 5.67842 9.89645 5.65088 9.85579C5.62384 9.81587 5.5979 9.77523 5.57194 9.73454C5.53673 9.67934 5.50258 9.62348 5.4694 9.56689C5.43575 9.50951 5.40162 9.45231 5.37012 9.39355ZM14.6287 9.39355C14.6091 9.43009 14.5881 9.46578 14.5677 9.50179C14.548 9.5365 14.5279 9.57093 14.5075 9.60514C14.4815 9.64868 14.455 9.69184 14.4277 9.73454C14.4048 9.77053 14.3807 9.80576 14.3569 9.84115C14.3327 9.87713 14.3088 9.91322 14.2837 9.94857C14.2613 9.9801 14.2384 10.0111 14.2153 10.0422C14.1722 10.1003 14.1282 10.1576 14.0827 10.2139C14.0444 10.2612 14.0054 10.3079 13.9655 10.3538C13.9344 10.3897 13.9023 10.4247 13.8703 10.4596C13.849 10.4829 13.8277 10.506 13.806 10.5288C13.7682 10.5686 13.7303 10.6082 13.6912 10.6468C13.6863 10.6517 13.6815 10.6566 13.6766 10.6615C13.6005 10.7361 13.5219 10.808 13.4414 10.8779C13.4044 10.9101 13.3671 10.942 13.3291 10.9731C13.2895 11.0056 13.2492 11.037 13.2087 11.0684C13.182 11.089 13.1551 11.1093 13.1281 11.1294C13.0849 11.1615 13.0413 11.193 12.9971 11.2238C12.9958 11.2247 12.9951 11.2262 12.9938 11.2271L12.7839 11.367C12.7593 11.3824 12.7338 11.396 12.709 11.411C12.6638 11.4382 12.6183 11.4648 12.5723 11.4907C12.5327 11.513 12.4928 11.5346 12.4526 11.5558C12.4176 11.5744 12.3824 11.5926 12.3468 11.6104C12.3066 11.6305 12.2664 11.6506 12.2256 11.6698C12.151 11.7047 12.0758 11.7391 11.9993 11.7707C12.0002 11.7742 12.0009 11.7777 12.0018 11.7812C12.0534 11.9838 12.0932 12.191 12.1206 12.4022C12.1222 12.4144 12.1232 12.4266 12.1247 12.4388C12.135 12.5232 12.1436 12.608 12.1499 12.6935C12.1519 12.7206 12.1548 12.7477 12.1564 12.7749C12.1624 12.8769 12.1662 12.98 12.1662 13.0833L12.1605 13.3218C12.1601 13.331 12.1585 13.3402 12.158 13.3494C12.1568 13.375 12.1548 13.4005 12.1532 13.4259C12.1491 13.4886 12.1448 13.551 12.1385 13.6131C12.1348 13.6499 12.13 13.6864 12.1255 13.723C12.1195 13.772 12.1133 13.8209 12.106 13.8695C12.1009 13.9026 12.0961 13.9358 12.0905 13.9687C12.0473 14.2219 11.9857 14.4689 11.9074 14.7085C11.8956 14.7445 11.8833 14.7803 11.8708 14.8159C11.8546 14.8621 11.8378 14.9079 11.8203 14.9535C11.8063 14.9901 11.7912 15.0263 11.7764 15.0625C11.7594 15.104 11.7423 15.1453 11.7243 15.1862C11.7104 15.2177 11.6972 15.2494 11.6828 15.2806C11.6558 15.3389 11.6264 15.396 11.5973 15.4531C11.5872 15.4729 11.5775 15.4929 11.5672 15.5125C11.4924 15.6549 11.4111 15.7933 11.3239 15.9276C11.2988 15.9662 11.2734 16.0045 11.2474 16.0423C11.225 16.0749 11.2022 16.1071 11.179 16.1392C11.1588 16.1672 11.1388 16.1954 11.118 16.223C11.0824 16.2702 11.0453 16.3162 11.0081 16.3621C10.9929 16.3811 10.9781 16.4004 10.9626 16.4191C10.9534 16.4302 10.945 16.4423 10.9357 16.4533C11.555 16.8526 12.2906 17.0832 13.0833 17.0832C15.2894 17.0831 17.083 15.2894 17.0832 13.0833C17.0831 11.428 16.0664 9.99776 14.6287 9.39355ZM9.99984 2.9165C7.79371 2.91657 6.00013 4.71023 6 6.91634C6 7.43752 6.10059 7.93759 6.27995 8.38932C6.32529 8.50365 6.37683 8.61491 6.43213 8.7238C6.84962 9.54583 7.54238 10.2038 8.39014 10.5776C8.49806 10.6252 8.60787 10.6697 8.72054 10.7078L8.94678 10.777L8.95085 10.7778C9.27762 10.8693 9.62912 10.9162 9.99984 10.9162C10.1922 10.9162 10.3793 10.9028 10.5605 10.8779C10.7285 10.8546 10.8916 10.8218 11.0488 10.7778C11.0499 10.7775 11.0511 10.7773 11.0521 10.777C11.2047 10.7353 11.3541 10.6843 11.4989 10.6257C12.1494 10.362 12.7149 9.93286 13.1427 9.3903C13.238 9.26958 13.3262 9.14322 13.4072 9.01188C13.4841 8.88716 13.5541 8.7578 13.6172 8.62451C13.6536 8.5476 13.6882 8.46964 13.7197 8.39014C13.8991 7.93841 13.9997 7.43751 13.9997 6.91634C13.9995 4.71023 12.206 2.91657 9.99984 2.9165Z" fill="currentColor" />
        </svg>
        <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">风格</span>
      </button>

      {showUploadButton && (
        <>
          {/* 参考按钮 = 原 +号上传按钮改版（spec 需求5/6：上传行为/data-testid 保留；§9-S2 图标还原 + 号、§9-S3 背景解撞值） */}
          <button
            data-testid="upload-button"
            aria-label="参考"
            onClick={handleUploadClick}
            className="flex h-[56px] w-[56px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[8px] bg-overlay-2 transition-colors hover:bg-overlay-3 focus:outline-none shadow-none outline-none"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span className="text-[12px] font-[400] leading-[120%] text-text-dim-2">参考</span>
          </button>
          <input
            ref={fileInputRef}
            data-testid="file-input"
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={disabled ? undefined : handleDragEnd}
      >
        <SortableContext items={images.map((img) => img.id)}>
          {images.map((image, idx) => (
            <SortableImageItem
              key={image.id}
              index={idx}
              image={image}
              onDelete={disabled ? () => {} : handleDeleteImage}
              onClick={disabled ? () => {} : onImageClick}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
