export interface DesignStudioProject {
  name: string;
  title: string;
  screenCount?: number;
  createTime?: string;
  updateTime?: string;
}

export interface DesignStudioApiResponse {
  projects: DesignStudioProject[];
  warning?: string;
  error?: string;
}
