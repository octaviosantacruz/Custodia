import * as echarts from 'echarts/core';
import { ScatterChart } from 'echarts/charts';
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([AriaComponent, CanvasRenderer, GridComponent, ScatterChart, TooltipComponent]);

export const initAdvancedChart = echarts.init;
