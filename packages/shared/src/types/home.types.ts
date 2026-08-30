export interface AnnouncementInfo {
  id: string;
  message: string;
  linkText: string | null;
  linkUrl: string | null;
  bgColor: string;
  textColor: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementDto {
  message: string;
  bgColor?: string;
  textColor?: string;
  linkText?: string | null;
  linkUrl?: string | null;
  active?: boolean;
}

export interface UpdateAnnouncementDto {
  message?: string;
  bgColor?: string;
  textColor?: string;
  linkText?: string | null;
  linkUrl?: string | null;
  active?: boolean;
}

export interface HomeBannerInfo {
  id: string;
  title: string | null;
  subtitle: string | null;
  linkUrl: string | null;
  imageKey?: string;
  imageUrl?: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicHomeBanner {
  id: string;
  title: string | null;
  subtitle: string | null;
  linkUrl: string | null;
  imageUrl: string;
  sortOrder: number;
}

export interface CreateHomeBannerDto {
  title?: string | null;
  subtitle?: string | null;
  linkUrl?: string | null;
  imageKey: string;
  sortOrder?: number;
  active?: boolean;
}

export interface UpdateHomeBannerDto {
  title?: string | null;
  subtitle?: string | null;
  linkUrl?: string | null;
  imageKey?: string;
  sortOrder?: number;
  active?: boolean;
}
