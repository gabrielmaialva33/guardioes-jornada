<script lang="ts">
	import { T } from '@threlte/core';
</script>

<T.PerspectiveCamera makeDefault position={[4, 3, 5]} oncreate={(camera) => camera.lookAt(0, 0.5, 0)} />
<T.HemisphereLight intensity={2} color="#dff3e7" groundColor="#294c32" />
<T.DirectionalLight intensity={2} position={[3, 5, 2]} />
<T.Mesh position.y={0.75} rotation.y={0.5}>
	<T.BoxGeometry args={[1, 1.5, 1]} />
	<T.MeshStandardMaterial color="#65b887" />
</T.Mesh>
<T.Mesh rotation.x={-Math.PI / 2}>
	<T.CircleGeometry args={[4, 24]} />
	<T.MeshStandardMaterial color="#284f36" />
</T.Mesh>
