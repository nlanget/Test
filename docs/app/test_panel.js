importScripts("https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.4/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.4/dist/wheels/panel-0.14.4-py3-none-any.whl', 'pyodide-http==0.1.0', 'holoviews>=1.15.4', 'hvplot', 'pandas']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import panel as pn
import hvplot.pandas

# Load Data
from bokeh.sampledata.autompg import autompg_clean as df

# Define Panel widgets
cylinders = pn.widgets.IntSlider(name='Cylinders', start=4, end=8, step=2)
mfr = pn.widgets.ToggleGroup(
    name='MFR',
    options=['ford', 'chevrolet', 'honda', 'toyota', 'audi'], 
    value=['ford', 'chevrolet', 'honda', 'toyota', 'audi'],
    button_type='success')
yaxis = pn.widgets.RadioButtonGroup(
    name='Y axis', 
    options=['hp', 'weight'],
    button_type='success'
)

# Define plotting function 
def plot(cylinders, mfr, yaxis):
    return (
        df[
            (df.cyl == cylinders) & 
            (df.mfr.isin(mfr))
        ]
        .groupby(['origin', 'mpg'])[yaxis].mean()
        .to_frame()
        .reset_index()
        .sort_values(by='mpg')  
        .reset_index(drop=True)
        .hvplot(x='mpg', y=yaxis, by='origin', color=["#ff6f69", "#ffcc5c", "#88d8b0"], line_width=6, height=400)
    )
    
# Bind plotting function with widgets 
interactive_plot = pn.bind(plot, cylinders, mfr, yaxis)

# Date range picker
import datetime
values = (datetime.datetime(2021, 3, 2, 12, 10), datetime.datetime(2021, 3, 2, 12, 22))
datetime_range_picker = pn.widgets.DatetimeRangePicker(name='Datetime Range Picker', value=values)

# Layout using Template
template = pn.template.FastListTemplate(
    title='Interactive DataFrame Dashboards with pn .bind', 
    sidebar=[cylinders, 'Manufacturers', mfr, 'Y axis' , yaxis, 'Date',datetime_range_picker],
    main=[interactive_plot],
    accent_base_color="#88d8b0",
    header_background="#88d8b0",
)
template.servable()
#template.show()

await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()