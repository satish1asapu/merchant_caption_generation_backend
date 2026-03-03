import { Module, Global, Injectable, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { createTunnel } from 'tunnel-ssh';
import { CaptionGenProject, CaptionGenProjectSchema } from '../models/caption-gen-project.schema';

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit() {
    if (this.connection.readyState === 1) {
      console.log('✅ MongoDB connected successfully');
      const dbName = this.connection.db?.databaseName;
      if (dbName) {
        console.log(`📊 Database: ${dbName}`);
      }
      try {
        const collections = await this.connection.db?.listCollections().toArray();
        if (collections && collections.length > 0) {
          console.log(`📁 Collections found: ${collections.length}`);
          collections.forEach(col => {
            console.log(`   - ${col.name}`);
          });
        } else {
          console.log(`📁 No collections found (will be created when first document is inserted)`);
        }
      } catch (error) {
        console.error('❌ Error listing collections:', error);
      }
    }
  }

  async listCollections(): Promise<string[]> {
    if (!this.connection.db) {
      throw new Error('Database connection not established yet.');
    }
    const cols = await this.connection.db.listCollections().toArray();
    return cols.map(col => col.name);
  }

  getCollection(name: string): any {
    if (!this.connection.db) {
      throw new Error('Database connection not established yet.');
    }
    return this.connection.db.collection(name);
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        console.log('🔌 Initializing MongoDB connection...');

        // SSH tunnel
        const sshEnabled = configService.get<string>('MONGODB_SSH_ENABLED') === 'true';
        if (sshEnabled) {
          console.log('✅ SSH Tunnel: ENABLED');
          const privateKey = configService.get<string>('MONGODB_SSH_KEY')?.replace(/\\n/g, '\n');
          const sshConfig = {
            host: configService.get<string>('SSH_BASTION_HOST'),
            port: parseInt(configService.get<string>('SSH_BASTION_PORT') || '22'),
            username: configService.get<string>('SSH_BASTION_USER'),
            privateKey,
            readyTimeout: 30000,
          };
          const tunnelConfig = { autoClose: false, reconnectOnError: false };
          const serverConfig = { port: parseInt(configService.get<string>('MONGODB_LOCAL_PORT') || '27018') };
          const forwardConfig = {
            srcAddr: '127.0.0.1',
            srcPort: parseInt(configService.get<string>('MONGODB_LOCAL_PORT') || '27018'),
            dstAddr: configService.get<string>('MONGODB_HOST'),
            dstPort: parseInt(configService.get<string>('MONGODB_PORT') || '27017'),
          };
          try {
            console.log(`🔗 Creating SSH tunnel to ${sshConfig.host}...`);
            await createTunnel(tunnelConfig, serverConfig, sshConfig, forwardConfig);
            console.log(`✅ SSH tunnel established on port ${serverConfig.port}`);
          } catch (error) {
            console.error('❌ Failed to create SSH tunnel:', error);
            throw error;
          }
        } else {
          console.log('⚠️  SSH Tunnel: DISABLED');
        }

        // MongoDB URI
        const authEnabled = configService.get<string>('MONGODB_AUTH_ENABLED') === 'true';
        const host = sshEnabled ? 'localhost' : configService.get<string>('MONGODB_HOST');
        const port = sshEnabled ? configService.get<string>('MONGODB_LOCAL_PORT') : configService.get<string>('MONGODB_PORT');
        const database = configService.get<string>('MONGODB_DATABASE');

        let uri: string;
        if (authEnabled) {
          const username = configService.get<string>('MONGODB_USERNAME') || '';
          const password = configService.get<string>('MONGODB_PASSWORD') || '';
          const authSource = configService.get<string>('MONGODB_AUTH_SOURCE') || 'admin';
          const userEncoded = encodeURIComponent(username);
          const passEncoded = encodeURIComponent(password);
          uri = `mongodb://${userEncoded}:${passEncoded}@${host}:${port}/${database}?authSource=${encodeURIComponent(authSource)}`;
          console.log('✅ MongoDB Authentication: ENABLED');
        } else {
          uri = `mongodb://${host}:${port}/${database}`;
          console.log('⚠️  MongoDB Authentication: DISABLED (Dev mode)');
        }
        const uriSafe = uri.replace(/:(.*?)@/, ':*****@');
        console.log(`🗄️  Connecting to MongoDB: ${uriSafe}`);

        return {
          uri,
          connectionFactory: (connection: any) => {
            connection.on('connected', () => {
              console.log('✅ MongoDB connection established');
            });
            connection.on('error', (error: any) => {
              console.error('❌ MongoDB connection error:', error);
            });
            connection.on('disconnected', () => {
              console.log('⚠️  MongoDB disconnected');
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: CaptionGenProject.name, schema: CaptionGenProjectSchema },
    ]),
  ],
  providers: [DatabaseService],
  exports: [MongooseModule, DatabaseService],
})
export class DatabaseModule {}
