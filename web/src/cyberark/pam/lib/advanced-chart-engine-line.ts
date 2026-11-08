import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([AriaComponent, CanvasRenderer, GridComponent, LegendComponent, LineChart, TooltipComponent]);

export const initAdvancedChart = echarts.init;
