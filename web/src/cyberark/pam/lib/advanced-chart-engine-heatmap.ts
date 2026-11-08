import * as echarts from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([AriaComponent, CanvasRenderer, GridComponent, HeatmapChart, TooltipComponent, VisualMapComponent]);

export const initAdvancedChart = echarts.init;
