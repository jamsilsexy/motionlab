import '../global.css';

import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';

export default function RootLayout() {
  const { user, initializing } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (initializing) return;
    const inAuthRoute = segments[0] === 'login';
    if (!user && !inAuthRoute) {
      router.replace('/login');
    } else if (user && inAuthRoute) {
      router.replace('/');
    }
  }, [user, initializing, segments, router]);

  if (initializing) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: '#fff',
            }}
          >
            <ActivityIndicator size="large" color="#4f46e5" />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="index" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
