"use client";

import { standardCatalog, type Catalog } from "@a2ui-sdk/react/0.8";

import { TempRangeChartComponent } from "./components/temp-range-chart";

/**
 * Nion A2UI catalog:
 * - Starts from the upstream standard catalog (@a2ui-sdk/react/0.8)
 * - Adds a small number of product-specific components that unlock "visualization" use-cases
 *   without introducing a second UI system or heavy dependencies.
 */
export const nionA2UICatalog: Catalog = {
  ...standardCatalog,
  components: {
    ...standardCatalog.components,
    TempRangeChart: TempRangeChartComponent,
  },
};

